function currentMachine() {
  try {
    return window.localStorage.getItem('ocm_machine') || 'local'
  } catch {
    return 'local'
  }
}

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-OPC-Machine': currentMachine() },
    ...options,
  })
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const detail = data && data.detail !== undefined ? data.detail : data
    let message = ''
    if (typeof detail === 'string') message = detail
    else if (detail && typeof detail === 'object') message = detail.message || JSON.stringify(detail)
    else message = `请求失败，状态码 ${res.status}`
    const error = new Error(message)
    error.status = res.status
    throw error
  }
  return data
}
