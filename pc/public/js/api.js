// 서버 API (같은 PC의 127.0.0.1)
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `요청 실패 (${res.status})`), { status: res.status, data });
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

export const audioUrl = (id) => `/api/tracks/${id}/audio`;
export const coverUrl = (id) => `/api/covers/${id}`; // 커버 ID = 그림 내용의 해시 (곡마다 store.coverIdFor)

export function subscribe(handlers) {
  const es = new EventSource('/api/events');
  for (const [type, fn] of Object.entries(handlers)) {
    es.addEventListener(type, (e) => {
      try {
        fn(JSON.parse(e.data));
      } catch (err) {
        console.error(type, err);
      }
    });
  }
  return es;
}
