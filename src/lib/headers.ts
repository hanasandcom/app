/** Native React Native builds do not guarantee the Web Headers constructor. */
export type HeaderRecord = Record<string, string>

function put(target: HeaderRecord, name: string, value: string) {
    target[name.toLowerCase()] = value
}

export function headerRecord(input?: HeadersInit | null): HeaderRecord {
    const result: HeaderRecord = {}
    if (!input) return result
    if (Array.isArray(input)) {
        for (const [name, value] of input) put(result, name, value)
        return result
    }
    const candidate = input as { forEach?: (callback: (value: string, name: string) => void) => void }
    if (typeof candidate.forEach === 'function') {
        candidate.forEach((value, name) => put(result, name, value))
        return result
    }
    for (const [name, value] of Object.entries(input as Record<string, string>)) put(result, name, value)
    return result
}

export function setHeader(headers: HeaderRecord, name: string, value: string) {
    headers[name.toLowerCase()] = value
}

export function deleteHeader(headers: HeaderRecord, name: string) {
    delete headers[name.toLowerCase()]
}

export function getHeader(input: HeadersInit | HeaderRecord | null | undefined, name: string): string | null {
    const lower = name.toLowerCase()
    if (input && typeof input === 'object' && !Array.isArray(input) && 'get' in input && typeof input.get === 'function') {
        const value = input.get(name)
        return typeof value === 'string' ? value : null
    }
    const headers = headerRecord(input as HeadersInit | null | undefined)
    return headers[lower] ?? null
}

export function responseLike(body: string | null, status: number, statusText = '', headersInput?: HeadersInit | null): Response {
    const values = headerRecord(headersInput)
    const headers = {
        get: (name: string) => values[name.toLowerCase()] ?? null,
        has: (name: string) => values[name.toLowerCase()] !== undefined,
        forEach: (callback: (value: string, name: string) => void) => Object.entries(values).forEach(([name, value]) => callback(value, name)),
        entries: () => Object.entries(values)[Symbol.iterator](),
    }
    const result = {
        ok: status >= 200 && status < 300,
        status,
        statusText,
        headers,
        body: null,
        text: async () => body ?? '',
        json: async () => JSON.parse(body ?? 'null') as unknown,
        clone: () => responseLike(body, status, statusText, values),
    }
    return result as unknown as Response
}
