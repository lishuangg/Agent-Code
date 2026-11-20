import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// 原始目录 读取所有 .md 文件
const documentDir = path.join(process.cwd(), "documents");

// 输出目录
const outputDir = path.join(process.cwd(), "output");

// 最终生成的 chunks 数据文件
const outputFile = path.join(outputDir, "chunks.json");

// 每个 Chunk 的最大长度，默认 120 个字符。
// 真实项目中一般会按 Token 数量控制，这里为了演示，先按字符数控制。
const chunkMaxLength = 120;

// Chunk 之间的重叠长度，默认 40 个字符。
// overlap 可以减少上下文被切断的问题。
const chunkOverlapLength = 40;

// 计算文本的 SHA-256 哈希值; 用于判断chunk是否发生变化
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 对原始文本做基础清洗。
 *
 * 主要处理：
 * 1. 统一换行符
 * 2. 替换 tab
 * 3. 合并多余空格
 * 4. 合并过多空行
 * 5. 去掉首尾空白
 */
function cleanText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 从 Markdown 文档里读取简单的元信息。
function readMetaLine(lines, name, fallback) {
  const line = lines.find((line) => line.startsWith(`${name}: `));
  if (!line) return fallback;
  return line.replace(`${name}: `, "").trim();
}

// 解析 Markdown 文档，提取内容和元信息。
function parseMarkdown({ fileName, rawText }) {
  const normalizedText = cleanText(rawText);
  const lines = normalizedText.split("\n");

  // 默认把一级标题作为文档标题。
  // 如果文档里没有一级标题，就使用文件名作为标题。
  const titleLine = lines.find((line) => line.startsWith("# "));
  const title = titleLine?.replace(/^#+\s*/, "").trim() || fileName;

  // 从文档中读取 Metadata。
  const category = readMetaLine(lines, "category", "unknown");
  const owner = readMetaLine(lines, "owner", "unknown");
  const sourceVersion = readMetaLine(lines, "version", "v1");

  // 正文中不再保留 category / owner / version 这些元信息行。
  // 这些信息会被放到 metadata 字段里。
  const body = lines
    .filter((line) => !line.startsWith("category:"))
    .filter((line) => !line.startsWith("owner:"))
    .filter((line) => !line.startsWith("version:"))
    .join("\n");

  return {
    fileName,
    title,
    category,
    owner,
    sourceVersion,
    text: cleanText(body),
  };
}

/**
 * 处理超长段落。
 *
 * 如果某个段落本身已经超过 chunkMaxLength，
 * 就只能按照固定长度继续切成多个小片段。
 */
function splitLongParagraph(paragraph) {
  const parts = [];

  for (let start = 0; start < paragraph.length; start += chunkMaxLength) {
    parts.push(paragraph.slice(start, start + chunkMaxLength).trim());
  }

  return parts.filter(Boolean);
}

/**
 * 把文档正文拆成段落数组。
 *
 * 规则：
 * - 先按空行拆分段落
 * - 段落内部的换行替换成空格
 * - 过滤空段落
 * - 如果段落太长，再继续切小
 */
function splitIntoParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .flatMap((paragraph) => {
      if (paragraph.length <= chunkMaxLength) {
        return [paragraph];
      }

      return splitLongParagraph(paragraph);
    });
}

/**
 * 从当前 Chunk 末尾取一段文本作为 overlap。
 *
 * overlap 的作用是：
 * 让相邻 Chunk 之间保留一点重复内容，
 * 避免重要语义刚好被切断。
 */
function takeOverlap(text) {
  if (chunkOverlapLength <= 0) {
    return "";
  }

  return text.slice(-chunkOverlapLength).trim();
}

/**
 * 生成稳定的 Chunk ID。
 *
 * Chunk ID 中包含：
 * - 来源文件名
 * - 来源版本
 * - Chunk 序号
 * - 内容哈希
 *
 * 这样做的好处是：
 * 当文档内容或版本变化时，可以更容易识别哪些 Chunk 发生了变化。
 */
function toChunkId({ fileName, sourceVersion, chunkIndex, content }) {
  const sourceName = fileName.replace(/\.md$/, "");
  const contentHash = sha256(content).slice(0, 12);
  const indexText = String(chunkIndex).padStart(3, "0");

  return `${sourceName}:${sourceVersion}:${indexText}:${contentHash}`;
}

/**
 * 从 documents 目录中加载所有 Markdown 文档。
 *
 * 这里只处理 .md 文件，并且按照文件名排序，
 * 这样每次运行时的处理顺序更稳定。
 */
async function loadMarkdownDocuments() {
  const entries = await readdir(documentDir, { withFileTypes: true });

  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  const documents = [];

  for (const fileName of markdownFiles) {
    const filePath = path.join(documentDir, fileName);
    const rawText = await readFile(filePath, "utf-8");
    documents.push(parseMarkdown({ fileName, rawText }));
  }

  return documents;
}

/**
 * 把一份文档切成多个 Chunk。
 *
 * 整体流程：
 * 1. 先把正文拆成段落
 * 2. 尽量把多个段落合并成一个 Chunk
 * 3. 如果超过最大长度，就结束当前 Chunk
 * 4. 新 Chunk 开头带上一点 overlap
 * 5. 最后为每个 Chunk 补充 metadata
 */
function createChunks(doc) {
  const paragraphs = splitIntoParagraphs(doc.text);

  const chunks = [];
  let current = [];

  for (const paragraph of paragraphs) {
    const nextText = [...current, paragraph].join("\n\n");
    // 如果加入后超过最大长度，就先保存当前 Chunk。
    if (nextText.length > 0 && nextText.length > chunkMaxLength) {
      const content = current.join("\n\n");
      chunks.push(content);
      // 从上一个 Chunk 的末尾取一小段作为下一个 Chunk 的开头。
      const overlap = takeOverlap(content);
      current = overlap ? [overlap, paragraph] : [paragraph];
      continue;
    }
    current.push(paragraph);
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks.map((content, index) => {
    const chunkIndex = index + 1;
    const contentHash = sha256(content).slice(0, 12);

    return {
      chunkId: toChunkId({
        fileName: doc.fileName,
        sourceVersion: doc.sourceVersion,
        chunkIndex,
        content,
      }),
      // Chunk 的正文内容。
      // 后续会对这个 content 做 Embedding。
      content,
      // Chunk 的元信息。
      // 后续检索、过滤、展示来源、版本更新都会用到这些信息。
      metadata: {
        source: doc.fileName,
        title: doc.title,
        category: doc.category,
        version: doc.sourceVersion,
        owner: doc.owner,
        chunkIndex,
        contentHash,
        chunkLength: content.length,
      },
    };
  });
}

async function main() {
  // 基础参数验证
  if (chunkMaxLength <= 0) {
    throw new Error("chunkMaxLength 必须大于 0");
  }
  if (chunkOverlapLength < 0) {
    throw new Error("chunkOverlapLength 不能小于 0");
  }

  // 读取原始文档
  const documents = await loadMarkdownDocuments();

  // 对文档进行分块
  const chunks = documents.flatMap(createChunks);

  // 确保输出目录存在
  await mkdir(outputDir, { recursive: true });
  // 将分块数据写入文件
  await writeFile(outputFile, JSON.stringify(chunks, null, 2), "utf-8");

  console.log("文档数量:", documents.length);
  console.log("分块数量:", chunks.length);
  console.log("分块数据已保存到:", outputFile);

  console.log("打印前三个 chunk");
  console.table(
    chunks.slice(0, 3).map((item) => ({
      chunkId: item.chunkId,
      title: item.metadata.title,
      category: item.metadata.category,
      version: item.metadata.sourceVersion,
      length: item.metadata.chunkLength,
    })),
  );
}

main();
