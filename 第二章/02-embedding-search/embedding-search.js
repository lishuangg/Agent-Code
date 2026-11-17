const apiKey = process.env.ZHIPU_API_KEY;
// 使用的 Embedding 模型，默认使用 embedding-3。
const model = process.env.EMBEDDING_MODEL ?? 'embedding-3';
// 指定向量维度。
// 这里默认生成 512 维向量，也就是每段文本最终会变成 512 个数字。
const dimensions = Number(process.env.EMBEDDING_DIMENSIONS) ?? 512;


// embedding-3 支持的向量维度范围。
// 不是所有维度都可以随便填，必须是模型支持的值。
const supportedDimensions = new Set([256, 512, 1024, 2048])

// 继续使用上一节的三份企业资料，这里可以理解为一个非常小的“知识库”。
const documents = [
	{
		id: 'blue-whale-refund',
		title: '蓝鲸退款规则',
		content: `普通商品签收后 7 天内可以申请退款。
退款金额超过 2000 元时，需要人工审核。`
	},
	{
		id: 'shipping-policy',
		title: '商品发货规则',
		content: `现货商品将在付款后 48 小时内发货。
偏远地区可能增加 1 到 3 天配送时间。`
	},
	{
		id: 'invoice-policy',
		title: '电子发票规则',
		content: `订单完成后可以申请电子发票。
企业发票需要提供公司抬头和税号。`
	}
]

/**
 * 调用 Embeddings API，把多段文本批量转换成向量。
 *
 * 例如：
 * [
 *   '用户问题',
 *   '退款规则',
 *   '发货规则'
 * ]
 *
 * 会被转换成：
 * [
 *   [0.01, 0.23, ...],
 *   [0.88, 0.12, ...],
 *   [0.33, 0.45, ...]
 * ]
 */
async function createEmbeddings(inputs) {
  if(!apiKey) {
    throw new Error('没有配置 ZHIPU_API_KEY，无法调用 Embeddings API');
  }

  if(!supportedDimensions.has(dimensions)) {
    throw new Error(`不支持的向量维度：${dimensions}，必须是 ${Array.from(supportedDimensions).join(', ')} 中的一个`);
  }

  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: inputs,
      dimensions,
    }),
  });

  const result = await response.json();

  if(!response.ok) {
    throw new Error(`模型调用失败：${JSON.stringify(result)}`);
  }

  // API 会为每一段输入返回一条 embedding。
	// 这里先根据 index 恢复输入顺序，再取出真正的向量数组。
  return result.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
}

/**
 * 计算两个向量的余弦相似度。
 *
 * 余弦相似度可以用来衡量两个向量方向是否接近。
 * 在语义检索里，方向越接近，通常表示两段文本语义越相似。
 */
function cosineSimilarity(firstVector, secondVector) {
  if(firstVector.length !== secondVector.length) {
    // 两个向量必须维度一致，否则不能直接计算相似度。
    throw new Error('向量维度不一致');
  }

  let dotProduct = 0
	let firstLength = 0
	let secondLength = 0

	// 遍历每一维，计算：
	// 1. 点积 dotProduct
	// 2. 第一个向量的长度平方
	// 3. 第二个向量的长度平方
  for(let i=0; i<firstVector.length; i++) {
    dotProduct += firstVector[i] * secondVector[i];
    firstLength += firstVector[i] * firstVector[i];
    secondLength += secondVector[i] * secondVector[i];
  }

  if(firstLength === 0 || secondLength === 0) {
    // 如果向量长度为 0，说明向量是零向量，不能计算相似度。
    throw new Error('不能计算零向量的余弦相似度');
  }

  // 余弦相似度公式：
	// 两个向量的点积 / 两个向量长度的乘积
  return dotProduct / (Math.sqrt(firstLength) * Math.sqrt(secondLength));
}


async function main() {
	// 这个问题没有直接出现“退款”和“人工审核”两个关键词。
	// 但是它的语义和“退款金额超过 2000 元，需要人工审核”是接近的。
	const question = '咖啡机不想要了，3000 元的订单应该走自动流程还是人工处理？'

  const inputs = [question, ...documents.map(doc => doc.content)];
  const [questionVector, ...documentVectors] = await createEmbeddings(inputs);

	console.log(`向量维度：${questionVector.length}`)
  // 这里只打印前 8 个数字，方便观察向量的大致形态。
	// 实际向量长度可能是 256、512、1024 或 2048。
	console.log('问题向量的前 8 个数字：')
	console.log(questionVector.slice(0, 8));

  // 分别计算“用户问题”与“每份资料”的相似度。
	// 相似度越高，说明这份资料越可能和用户问题相关。
  const result = documents.map((doc, index) => {
    const similarity = cosineSimilarity(questionVector, documentVectors[index]);
    return {
      id: doc.id,
      title: doc.title,
      similarity,
    }
  }).sort((a, b) => b.similarity - a.similarity);

  console.log('\n相似度排序结果：')
  console.table(result.map(item => ({...item, similarity: item.similarity.toFixed(6)})))

  return result[0];
}

main().then(result => {
  console.log('\n最相似的资料：')
  console.log(result)
}).catch(error => {
  console.error('程序运行失败：', error)
})