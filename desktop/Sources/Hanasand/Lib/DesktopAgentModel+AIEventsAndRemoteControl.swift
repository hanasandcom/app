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

    func handleAISocketText(_ text: String) async {
        guard let data = text.data(using: .utf8),
              let event = try? JSONDecoder().decode(AISocketEvent.self, from: data) else {
            return
        }

        switch event.type {
        case "snapshot":
            aiClients = (event.clients ?? []).sortedForRuntime
            updateAISummaryFromClients()
        case "update":
            if let client = event.client {
                upsertAIClient(client)
                updateAISummaryFromClients()
            }
        case "prompt_started":
            guard isActiveAIEvent(event) else { return }
            ensureActiveAIResponse(conversationId: event.conversationId)
        case "prompt_tool":
            guard isActiveAIEvent(event) else { return }
            let label = event.toolLabel ?? event.toolId ?? "Tool"
            let detail = [event.toolState, event.toolDetail].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: " · ")
            appendAITrace(.tool, title: label, detail: detail.isEmpty ? "Tool event received." : detail)
        case "prompt_delta":
            guard isActiveAIEvent(event) else { return }
            appendToActiveAIResponse(event.delta ?? "")
        case "prompt_complete":
            guard isActiveAIEvent(event) else { return }
            finishActiveAIResponse(content: event.content, artifacts: event.artifacts ?? [], overhead: event.overhead)
        case "prompt_error":
            guard isActiveAIEvent(event) else { return }
            let message = event.error ?? "The model failed to answer this prompt."
            if let snapshot = rateLimitSnapshot(from: message) {
                applyAIRateLimit(snapshot)
                finishRateLimitedAIResponse()
                return
            }
            appendAITrace(.error, title: "Model error", detail: message)
            failActiveAIResponse(message)
        default:
            break
        }
    }

    func isActiveAIEvent(_ event: AISocketEvent) -> Bool {
        guard let active = aiActiveConversationID else { return true }
        return event.conversationId == nil || event.conversationId == active
    }

    func appendToActiveAIResponse(_ delta: String) {
        guard !delta.isEmpty else { return }
        if let index = aiMessages.lastIndex(where: { $0.isPending && $0.role == .assistant }) {
            aiMessages[index].content += delta
        } else {
            aiMessages.append(AIChatMessage(role: .assistant, content: delta, isPending: true))
        }
    }

    func finishActiveAIResponse(content: String?, artifacts: [AIArtifact], overhead: AIOverheadSample?) {
        isRunning = false
        aiLastDuration = elapsedAIRunText(overhead: overhead)
        if let index = aiMessages.lastIndex(where: { $0.isPending && $0.role == .assistant }) {
            if let content, !content.isEmpty {
                aiMessages[index].content = content
            }
            aiMessages[index].isPending = false
        } else if let content, !content.isEmpty, !aiMessages.contains(where: { $0.role == .assistant && $0.content == content }) {
            aiMessages.append(AIChatMessage(role: .assistant, content: content))
        }

        if !artifacts.isEmpty {
            for artifact in artifacts.prefix(8) {
                appendAITrace(.file, title: artifact.displayTitle, detail: artifact.displayDetail)
            }
        }
        runNextQueuedPrompt()
    }

    func failActiveAIResponse(_ message: String) {
        isRunning = false
        aiLastDuration = elapsedAIRunText()
        if let index = aiMessages.lastIndex(where: { $0.isPending && $0.role == .assistant }) {
            aiMessages[index].content = message
            aiMessages[index].isPending = false
            aiMessages[index].isError = true
        } else {
            aiMessages.append(AIChatMessage(role: .assistant, content: message, isError: true))
        }
        runNextQueuedPrompt()
    }

    func ensureActiveAIResponse(conversationId: String?) {
        if aiMessages.contains(where: { $0.isPending && $0.role == .assistant }) {
            return
        }

        aiMessages.append(AIChatMessage(
            id: "\(conversationId ?? UUID().uuidString)-assistant",
            role: .assistant,
            content: "",
            isPending: true
        ))
    }

    func elapsedAIRunText(overhead: AIOverheadSample? = nil) -> String {
        if let totalMs = overhead?.stages?["totalMs"] {
            return formatMilliseconds(totalMs)
        }
        guard let aiRunStartedAt else { return "unknown duration" }
        return formatMilliseconds(Date().timeIntervalSince(aiRunStartedAt) * 1000)
    }

    func appendAITrace(_ kind: AITraceEvent.Kind, title: String, detail: String) {
        aiTrace.append(AITraceEvent(kind: kind, title: title, detail: detail))
        if aiTrace.count > 80 {
            aiTrace.removeFirst(aiTrace.count - 80)
        }
    }

    func upsertAIClient(_ client: AIConnectedClient) {
        if let index = aiClients.firstIndex(where: { $0.name == client.name }) {
            aiClients[index] = client
        } else {
            aiClients.append(client)
        }
        aiClients = aiClients.sortedForRuntime
    }

    func updateAISummaryFromClients() {
        let names = aiClients.map(\.name).filter { !$0.isEmpty }
        aiSummary = names.isEmpty ? (aiSocketConnected ? "No connected models" : "Not connected") : names.joined(separator: ", ")
    }

    func openVPN() {
        currentTaskState = "Opening VPN"
        guard let url = URL(string: settings.vpnURLScheme) else {
            append(meta: "VPN", body: "Invalid VPN URL scheme.", kind: .error)
            recordRun(title: "VPN error", detail: "Invalid VPN URL scheme", kind: .error)
            currentTaskState = "Idle"
            return
        }
        NSWorkspace.shared.open(url)
        append(meta: "VPN", body: url.absoluteString, kind: .command)
        recordRun(title: "VPN", detail: url.absoluteString, kind: .command)
        currentTaskState = "Idle"
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            await self?.checkServerReachability(silent: true)
        }
    }

    func openWebsite(path: String, label: String) {
        let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let url = settings.websiteBaseURL.normalizedBaseURL.appendingPathComponent(normalizedPath)
        NSWorkspace.shared.open(url)
        append(meta: "Opened \(label)", body: url.absoluteString, kind: .command)
    }

    func recordUIEvent(meta: String, body: String, kind: AgentEvent.Kind = .note) {
        append(meta: meta, body: body, kind: kind)
    }
}
