const messages = [
  {
    role: 'system',
    content: '你是某某公司的退款审核助手，回答时只根据当前对话中已经提供的信息判断。'
  }
]

const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'

async function sendMessage(userContent, demoAssistantReply) {
  messages.push({
    role: 'user',
    content: userContent
  })
  const requestBody = {
    model,
    messages,
    stream: false,
    thinking: {
      type: 'disabled'
    }
  }

  console.log('\n本轮准备发送给 DeepSeek API 的 messages：')
  console.dir(requestBody.messages, { depth: null })

  if(!process.env.DEEPSEEK_MODEL) {
    console.log('\n没有检测到 DEEPSEEK_API_KEY，使用演示回复：')
    console.log(demoAssistantReply)
    messages.push({
      role: 'assistant',
      content: demoAssistantReply
    })
    return ;
  }
  const httpRes = await fetch(
    'https://api.deepseek.com/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  )
  const response = await httpRes.json();
  
  if(!httpRes.ok) {
    console.error('DeepSeek API 返回错误：')
    console.dir(response, { depth: null })
    process.exit(1)
  }

  const assistantMessage = response.choices[0].message


  console.log('\nDeepSeek 回答：')
  console.log(assistantMessage.content)
  
  console.log('\n本轮 Token 用量：')
  console.dir(response.usage, { depth: null })

  messages.push({
    role: 'assistant',
    content: assistantMessage.content
  })
}


// 第一轮对话：用户只告诉模型订单金额。
// 但是此时还没有告诉模型“超过多少钱需要人工审核”的规则，
// 所以模型应该无法判断。
await sendMessage(
    '订单 A1024 的退款金额是 3000 元，是否需要人工审核？',
    '目前缺少退款规则，无法判断是否需要人工审核。'
)

// 第二轮对话：用户补充退款规则。
// 因为第一轮的订单金额还保存在 messages 中，
// 所以模型现在可以结合历史信息判断：3000 元超过 2000 元，需要人工审核。
await sendMessage(
    '退款金额超过 2000 元时，需要人工审核。',
    '根据刚刚提供的规则，订单 A1024 需要人工审核。'
)

// 第三轮对话：用户追问原因。
// 因为 messages 中已经包含：
// 1. 订单 A1024 的退款金额是 3000 元
// 2. 超过 2000 元需要人工审核
// 3. 模型上一轮已经判断需要人工审核
//
// 所以模型可以回答判断依据。
await sendMessage(
    '为什么？只回答依据。',
    '因为订单 A1024 的退款金额为 3000 元，超过了 2000 元。'
)