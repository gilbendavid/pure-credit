/** Sends a serialized application to the configured workflow endpoint. */
export function postLoanApplication(url, payload, fetchImpl = globalThis.fetch) {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Interprets n8n responses while preserving its optional message/status. */
export async function readWorkflowResponse(response) {
  let body = null;
  try {
    const text = await response.text();
    if (text.trim() !== '') body = JSON.parse(text);
  } catch {
    body = null;
  }

  const hasVerdict = body !== null && typeof body === 'object' && 'success' in body;
  return {
    ok: response.ok && (hasVerdict ? body.success === true : true),
    message: typeof body?.message === 'string' ? body.message : '',
    status: typeof body?.status === 'string' ? body.status.trim() : '',
  };
}
