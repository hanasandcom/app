import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

extension DesktopAgentModel {

    func loadAIPage() async {
        await loadAiModels()
        connectAISocket()
        if aiTrace.isEmpty {
            appendAITrace(.system, title: "Runtime", detail: "Connected to the Hanasand model pool and ready to stream chat, tools, timings, and file artifacts.")
        }
    }

    func connectAISocket() {
        if aiSocketTask != nil { return }
        aiSocketReconnectTask?.cancel()
        aiSocketReconnectTask = nil
        guard let url = settings.apiBaseURL.websocketBaseURL?.appendingPathComponent("client/ws/gpt") else {
            aiSummary = "Invalid websocket URL"
            appendAITrace(.error, title: "Socket", detail: "Could not derive a websocket URL from \(settings.apiBaseURL).")
            return
        }

        let task = URLSession.shared.webSocketTask(with: url)
        aiSocketTask = task
        aiSocketConnected = true
        aiSocketReconnectAttempt = 0
        aiSummary = aiClients.isEmpty ? "Connecting to model pool" : aiSummary
        task.resume()

        aiReceiveTask?.cancel()
        aiReceiveTask = Task { [weak self] in
            await self?.receiveAISocketMessages()
        }
    }

    func disconnectAISocket() {
        aiSocketReconnectTask?.cancel()
        aiSocketReconnectTask = nil
        aiReceiveTask?.cancel()
        aiReceiveTask = nil
        aiSocketTask?.cancel(with: .goingAway, reason: nil)
        aiSocketTask = nil
        aiSocketConnected = false
    }

    func submitAIChatPrompt() {
        submitAIChatPrompt(prompt)
    }

    func submitAppParityTrainingPrompt() {
        submitAIChatPrompt(DesktopAITraining.appParityPrompt, maxTokens: 650, temperature: 0.2)
    }

    func submitDesktopUIAuditPrompt() {
        submitAIChatPrompt(DesktopAITraining.desktopUIAuditPrompt, maxTokens: 850, temperature: 0.2)
    }

    func submitAIChatPrompt(_ rawPrompt: String, maxTokens: Int = 900, temperature: Double = 0.7) {
        let trimmed = rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if isAIRateLimited {
            schedulePrompt(trimmed)
            if rawPrompt == prompt {
                prompt = ""
            }
            return
        }
        if isRunning {
            schedulePrompt(trimmed)
            if rawPrompt == prompt {
                prompt = ""
            }
            return
        }
        if rawPrompt == prompt {
            prompt = ""
        }

        if handleLocalAIBrowserCommand(trimmed) {
            return
        }
        if let editCommand = IDEEditChatCommand.parse(trimmed) {
            aiMessages.append(AIChatMessage(role: .user, content: trimmed))
            createPendingIDEEdit(editCommand)
            return
        }
        if handleLocalAIIDECommand(trimmed) {
            return
        }

        isRunning = true

        let userMessage = AIChatMessage(role: .user, content: trimmed)
        aiMessages.append(userMessage)
        let bestClient = aiClients.sortedForRuntime.first

        guard let bestClient else {
            beginVisibleAIRun(
                prompt: trimmed,
                prefix: "desktop-http",
                title: "Finding model",
                detail: "No live websocket model is selected yet. Using the authenticated Hanasand AI endpoint so progress is still visible."
            )
            Task { [weak self] in
                guard let self else { return }
                defer {
                    self.isRunning = false
                    self.runNextQueuedPrompt()
                }
                await self.sendFallbackAIChat(trimmed)
            }
            return
        }

        guard let socket = aiSocketTask, aiSocketConnected else {
            beginVisibleAIRun(
                prompt: trimmed,
                prefix: "desktop-http",
                title: "Connecting",
                detail: "The websocket is not ready. Falling back to the authenticated Hanasand AI endpoint and showing progress here."
            )
            Task { [weak self] in
                guard let self else { return }
                defer {
                    self.isRunning = false
                    self.runNextQueuedPrompt()
                }
                await self.sendFallbackAIChat(trimmed)
            }
            return
        }

        let conversationId = "desktop-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))"
        aiActiveConversationID = conversationId
        aiRunStartedAt = Date()
        aiLastDuration = "Running"
        aiTrace.removeAll()
        seedVisibleAIWork(for: trimmed)

        let request = AIPromptRequest(
            type: "prompt_request",
            conversationId: conversationId,
            clientName: bestClient.name,
            messages: aiRequestMessages(),
            maxTokens: maxTokens,
            temperature: temperature
        )
        ensureActiveAIResponse(conversationId: conversationId)

        do {
            let data = try JSONEncoder().encode(request)
            guard let text = String(data: data, encoding: .utf8) else {
                throw HanasandAIError.invalidPayload
            }
            socket.send(.string(text)) { [weak self] error in
                guard let self else { return }
                Task { @MainActor in
                    if let error {
                        self.aiSummary = "Reconnecting to model pool"
                        self.scheduleAISocketReconnect(reason: error.localizedDescription)
                        Task { [weak self] in
                            guard let self else { return }
                            await self.sendFallbackAIChat(trimmed)
                        }
                    }
                }
            }
        } catch {
            appendAITrace(.error, title: "Request", detail: error.localizedDescription)
            failActiveAIResponse(error.localizedDescription)
        }
    }

    func beginVisibleAIRun(prompt: String, prefix: String, title: String, detail: String) {
        let conversationId = "\(prefix)-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))"
        aiActiveConversationID = conversationId
        aiRunStartedAt = Date()
        aiLastDuration = "Running"
        aiTrace.removeAll()
        seedVisibleAIWork(for: prompt)
        ensureActiveAIResponse(conversationId: conversationId)
    }

    func seedVisibleAIWork(for prompt: String) {
        let lower = prompt.lowercased()
        if lower.contains("nextjs") || lower.contains("next.js") {
            appendAITrace(
                .tool,
                title: "sandbox/ai-nextjs-app",
                detail: [
                    "Creating files in sandbox/ai-nextjs-app",
                    "Writing package.json, tsconfig.json, next.config.ts, src/app/layout.tsx, src/app/page.tsx, and src/app/globals.css",
                ].joined(separator: "\n")
            )
            return
        }
        if lower.contains("search") || lower.contains("find") {
            appendAITrace(.tool, title: "Searching workspace", detail: "Listing project files and locating the relevant code paths")
            return
        }
    }

    func handleLocalAIBrowserCommand(_ prompt: String) -> Bool {
        guard let command = BrowserChatCommand.parse(prompt) else { return false }

        aiMessages.append(AIChatMessage(role: .user, content: prompt))
        switch command.kind {
        case .open:
            let resolved = BrowserTargetResolver.resolve(command.target)
            openAIInlineBrowser(url: resolved.url, title: resolved.title, source: "AI chat")
            aiMessages.append(AIChatMessage(role: .assistant, content: "Opened \(resolved.title) in the inline AI browser."))
            appendAITrace(.tool, title: "Browser", detail: "Opened \(resolved.url) from a local AI chat command.")
        case .popOut:
            let resolved = BrowserTargetResolver.resolve(command.target)
            popOutBrowser(url: resolved.url, title: resolved.title, minified: false, source: "AI chat")
            aiMessages.append(AIChatMessage(role: .assistant, content: "Popped out \(resolved.title) in the Hanasand floating browser."))
            appendAITrace(.tool, title: "Browser pop out", detail: "Opened \(resolved.url) in the existing floating browser.")
        case .popOutCurrent:
            popOutBrowser(source: "AI chat")
            aiMessages.append(AIChatMessage(role: .assistant, content: "Popped out the current Workspace browser page."))
            appendAITrace(.tool, title: "Browser pop out", detail: "Opened \(browserActiveAddress) in the existing floating browser.")
        }
        return true
    }
}
