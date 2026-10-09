#!/usr/bin/env node
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const pollMs = Number(process.env.HANASAND_PROMPT_IDLE_SECONDS || 600) * 1000
const endpoint = await workerEndpoint()
const codexBin = process.env.HANASAND_CODEX_BIN || '/Applications/Codex.app/Contents/Resources/codex'
const repoDir = process.env.HANASAND_CODEX_REPO || '/Users/eirikhanasand/Desktop/personal/hanasand'
const logFile = process.env.HANASAND_PROMPT_WORKER_LOG || path.join(tmpdir(), 'hanasand-prompt-worker.log')

if (process.argv.includes('--self-check')) {
    assert.equal(nextDelay(true, pollMs), 0)
    assert.equal(nextDelay(false, pollMs), pollMs)
    process.exit(0)
}

await mkdir(path.dirname(logFile), { recursive: true })
await log('started')

while (true) {
    try {
        const hadItem = await runOnce()
        await sleep(nextDelay(hadItem, pollMs))
    } catch (error) {
        await log(`loop error: ${shortError(error)}`)
        await sleep(pollMs)
    }
}

async function runOnce() {
    const payload = await getJson(endpoint)
    if (!payload?.item) return false

    const item = payload.item
    try {
        const result = await runCodex(item)
        await complete(item.id, 'done', result)
        await log(`completed ${item.id}`)
    } catch (error) {
        const result = shortError(error)
        await complete(item.id, 'error', result)
        await log(`failed ${item.id}: ${result}`)
    }
    return true
}

async function runCodex(item) {
    const promptFile = path.join(tmpdir(), `hanasand-prompt-${Date.now()}.txt`)
    const outputFile = path.join(tmpdir(), `hanasand-prompt-${Date.now()}.out`)
    const files = Array.isArray(item.files) && item.files.length
        ? `\n\nAttached files, fetch only if needed:\n${item.files.map(file => `- ${file.name || file.id}: ${file.url}`).join('\n')}`
        : ''
    await writeFile(promptFile, `Read /Users/eirikhanasand/.codex/AGENTS.md first.\n\n${item.prompt}${files}\n\nWhen done, answer with a short completion summary only.`)

    const { code, stderr } = await run(codexBin, [
        'exec',
        '--cd', repoDir,
        '--sandbox', 'workspace-write',
        '--full-auto',
        '--output-last-message', outputFile,
        '-',
    ], await readFile(promptFile))
    const output = await readFile(outputFile, 'utf8').catch(() => '')
    if (code !== 0) throw new Error(output || stderr || `codex exited ${code}`)
    return output.trim().slice(0, 20_000) || 'Completed.'
}

async function complete(id, status, result) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', id, status, result: String(result).slice(0, 20_000) }),
    })
    if (!response.ok) throw new Error(`completion post failed: ${response.status} ${await response.text()}`)
}

async function getJson(url) {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`poll failed: ${response.status} ${await response.text()}`)
    return response.json()
}

function run(command, args, stdin) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd: repoDir, stdio: ['pipe', 'ignore', 'pipe'] })
        let stderr = ''
        child.stderr.on('data', chunk => { stderr += chunk })
        child.on('close', code => resolve({ code, stderr }))
        child.stdin.end(stdin)
    })
}

async function workerEndpoint() {
    if (process.env.HANASAND_PROMPT_WORKER_URL) return process.env.HANASAND_PROMPT_WORKER_URL
    const token = process.env.HANASAND_PROMPT_WORKER_TOKEN || await tokenFromAgents()
    if (!token) throw new Error('Set HANASAND_PROMPT_WORKER_URL or HANASAND_PROMPT_WORKER_TOKEN.')
    return `https://hanasand.com/api/prompt/worker?token=${encodeURIComponent(token)}`
}

async function tokenFromAgents() {
    const agents = await readFile(path.join(homedir(), '.codex/AGENTS.md'), 'utf8').catch(() => '')
    return agents.match(/token=([A-Za-z0-9_-]{40,})/)?.[1] || ''
}

async function log(message) {
    await writeFile(logFile, `${new Date().toISOString()} ${message}\n`, { flag: 'a' })
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function nextDelay(hadItem, idleMs) {
    return hadItem ? 0 : idleMs
}

function shortError(error) {
    return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}
