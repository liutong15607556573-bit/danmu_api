import { handleRequestWithTrace } from '../danmu_api/worker.js';

export const onRequest = async (context) => {
  const { request, env } = context;

  // 获取协议和主机名，使用属性访问而非 get 方法
  const baseUrl = `https://localhost`;

  // 调试：打印 headers 和原始 URL
  console.log('Request URL:', request.url);
  console.log('Request Headers:', request.headers);

  // 构造完整的 URL
  let fullUrl;
  try {
    let targetUrl = request.url;

    // 判断是否包含 node-functions/index.js，如果是则用 / 代替
    if (request.url.includes('node-functions/index.js')) {
      targetUrl = '/';
    }

    fullUrl = new URL(targetUrl, baseUrl).toString();
    console.log('Request fullUrl:', fullUrl);
  } catch (error) {
    console.error('URL Construction Error:', error);
    return new Response('Invalid URL', { status: 400 });
  }

  // 保留原始请求体字节。request.body 是 ReadableStream，JSON.stringify(stream)
  // 会变成 "{}"，破坏 POST JSON；GET/HEAD 则不能传入 body。
  const requestBody = request.body && request.method !== 'GET' && request.method !== 'HEAD'
    ? await request.clone().arrayBuffer()
    : undefined;
  const modifiedRequest = new Request(fullUrl, {
    method: request.method,
    headers: request.headers,
    body: requestBody,
    redirect: request.redirect,
    credentials: request.credentials,
    cache: request.cache,
    mode: request.mode
  });

  // 获取客户端 IP 地址
  let clientIp = 'unknown';

  // Headers 必须通过 .get() 读取，而不是对象属性访问。
  clientIp = request.headers.get('eo-connecting-ip');
  if (!clientIp) {
    // 如果 EO-Connecting-IP 不存在，尝试从 X-Forwarded-For 获取
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      // X-Forwarded-For 可能包含多个 IP 地址，选择第一个（最原始客户端 IP）
      clientIp = forwardedFor.split(',')[0].trim();
    }
  }

  // 传递带完整 URL 的 request 和 env 给核心处理函数
  return await handleRequestWithTrace(modifiedRequest, env, "edgeone", clientIp, context);
};
