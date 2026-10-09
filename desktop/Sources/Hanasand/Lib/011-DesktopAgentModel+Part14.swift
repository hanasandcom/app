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

    func handleLocalAIIDECommand(_ prompt: String) -> Bool {
        guard let command = IDEChatCommand.parse(prompt) else { return false }
        aiMessages.append(AIChatMessage(role: .user, content: prompt))
        openIDEFile(command.path, line: command.line, revealDiff: command.revealDiff, source: "AI chat")
        if let line = command.line {
            aiMessages.append(AIChatMessage(role: .assistant, content: "Opened \(command.path) at line \(line) in the native IDE and highlighted the target line."))
            appendAITrace(.tool, title: "IDE line", detail: "\(command.path):\(line)")
        } else if command.revealDiff {
            aiMessages.append(AIChatMessage(role: .assistant, content: "Opened the inline diff for \(command.path) and loaded the file in the native IDE."))
            appendAITrace(.tool, title: "IDE diff", detail: command.path)
        } else {
            aiMessages.append(AIChatMessage(role: .assistant, content: "Opened \(command.path) in the native IDE."))
            appendAITrace(.tool, title: "IDE file", detail: command.path)
        }
        return true
    }

    func sendFallbackAIChat(_ prompt: String) async {
        let context = ([DesktopAITraining.appParityPrimer] + aiMessages.suffix(8).map { "\($0.role.rawValue): \($0.content)" }).joined(separator: "\n\n")
        do {
            let response = try await fallbackAIClient().send(
                prompt: prompt,
                context: context
            )
            finishFallbackAIResponse(response)
            aiSummary = response.meta
            aiLastDuration = "HTTP fallback"
        } catch {
            if isAuthSessionFailure(error) {
                appendAITrace(.system, title: "Session refresh", detail: "The Hanasand session was refreshed below the hood. Retrying the chat request once.")
                do {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    let response = try await fallbackAIClient().send(prompt: prompt, context: context)
                    finishFallbackAIResponse(response)
                    aiSummary = response.meta
                    aiLastDuration = "HTTP fallback"
                    return
                } catch {
                    if let snapshot = self.rateLimitSnapshot(from: error) {
                        self.applyAIRateLimit(snapshot)
                        self.finishRateLimitedAIResponse()
                        return
                    }
                    failFallbackAIResponse(humanReadableAIError(error))
                    appendAITrace(.error, title: "Session retry failed", detail: humanReadableAIError(error))
                    return
                }
            }
            if let snapshot = rateLimitSnapshot(from: error) {
                applyAIRateLimit(snapshot)
                finishRateLimitedAIResponse()
                return
            }
            if isTemporaryAIOutage(error) {
                await retryFallbackAIChat(prompt: prompt, context: context, firstError: error)
                return
            }
            failFallbackAIResponse(humanReadableAIError(error))
            appendAITrace(.error, title: "Fallback failed", detail: error.localizedDescription)
        }
    }

    func retryFallbackAIChat(prompt: String, context: String, firstError: Error) async {
        let startedAt = Date()
        let noticeID = "ai-reconnect-\(Int(startedAt.timeIntervalSince1970 * 1000))"
        aiMessages.append(AIChatMessage(
            id: noticeID,
            role: .assistant,
            content: "Reconnecting",
            createdAt: startedAt,
            isPending: true,
            isError: false,
            isReconnectNotice: true,
            reconnectStartedAt: startedAt
        ))
        aiSummary = "Reconnecting"
        appendAITrace(.error, title: "Temporary outage", detail: humanReadableAIError(firstError))

        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            do {
                let response = try await fallbackAIClient().send(prompt: prompt, context: context)
                let reconnectedAt = Date()
                if let index = aiMessages.firstIndex(where: { $0.id == noticeID }) {
                    let duration = humanReadableDuration(reconnectedAt.timeIntervalSince(startedAt))
                    aiMessages[index].content = "Reconnected after \(duration)"
                    aiMessages[index].isPending = false
                    aiMessages[index].isError = false
                    aiMessages[index].reconnectedAt = reconnectedAt
                }
                aiMessages.append(AIChatMessage(role: .assistant, content: response.body))
                aiSummary = response.meta
                aiLastDuration = "HTTP fallback"
                appendAITrace(.thought, title: "Reconnected", detail: "The HTTP AI endpoint recovered after \(humanReadableDuration(reconnectedAt.timeIntervalSince(startedAt))).")
                return
            } catch {
                if let snapshot = rateLimitSnapshot(from: error) {
                    applyAIRateLimit(snapshot)
                    if let index = aiMessages.firstIndex(where: { $0.id == noticeID }) {
                        aiMessages.remove(at: index)
                    }
                    finishRateLimitedAIResponse()
                    return
                }
                if !isTemporaryAIOutage(error) {
                    if let index = aiMessages.firstIndex(where: { $0.id == noticeID }) {
                        aiMessages[index].content = humanReadableAIError(error)
                        aiMessages[index].isPending = false
                        aiMessages[index].isError = true
                    } else {
                        aiMessages.append(AIChatMessage(role: .assistant, content: humanReadableAIError(error), isError: true))
                    }
                    aiSummary = "AI unavailable"
                    appendAITrace(.error, title: "Reconnect stopped", detail: error.localizedDescription)
                    return
                }
                aiSummary = "Reconnecting"
            }
        }
    }

    func fallbackAIClient() -> HanasandAIClient {
        HanasandAIClient(
            apiURL: settings.resolvedAIEndpoint,
            token: authTokenForRequests,
            userId: userIDForRequests
        )
    }

    func finishFallbackAIResponse(_ response: HanasandAIResponse) {
        isRunning = false
        if let index = aiMessages.lastIndex(where: { $0.isPending && $0.role == .assistant }) {
            aiMessages[index].content = response.body
            aiMessages[index].isPending = false
            aiMessages[index].isError = false
        } else {
            aiMessages.append(AIChatMessage(role: .assistant, content: response.body))
        }
    }

    func failFallbackAIResponse(_ message: String) {
        isRunning = false
        if let index = aiMessages.lastIndex(where: { $0.isPending && $0.role == .assistant }) {
            aiMessages[index].content = message
            aiMessages[index].isPending = false
            aiMessages[index].isError = true
        } else {
            aiMessages.append(AIChatMessage(role: .assistant, content: message, isError: true))
        }
    }

    func isTemporaryAIOutage(_ error: Error) -> Bool {
        if case HanasandAIError.httpStatus(let status, _, _) = error, [502, 503, 504].contains(status) {
            return true
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .timedOut, .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet, .dnsLookupFailed:
                return true
            default:
                return false
            }
        }
        return false
    }

    func isAuthSessionFailure(_ error: Error) -> Bool {
        if case HanasandAIError.httpStatus(let status, _, _) = error, status == 401 {
            return true
        }
        return false
    }

    func humanReadableAIError(_ error: Error) -> String {
        if isAuthSessionFailure(error) {
            return "Refreshing the Hanasand session in the background. Try again in a moment if this message stays visible."
        }
        if case HanasandAIError.httpStatus(let status, let detail, _) = error, [502, 503, 504].contains(status) {
            return detail ?? "The AI service is taking longer than expected. I’ll keep trying in the background."
        }
        return error.localizedDescription
    }

    func humanReadableDuration(_ interval: TimeInterval) -> String {
        let seconds = max(1, Int(interval.rounded()))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        return "\(hours)h"
    }

    func scheduleAISocketReconnect(reason: String) {
        aiSocketTask = nil
        aiSocketConnected = false
        aiSummary = "Reconnecting to model pool"
        guard aiSocketReconnectTask == nil else { return }

        aiSocketReconnectTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let attempt = await MainActor.run { () -> Int in
                    self.aiSocketReconnectAttempt += 1
                    return self.aiSocketReconnectAttempt
                }
                let delay = min(60, max(1, Int(pow(1.7, Double(attempt - 1)))))
                try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000_000)
                if Task.isCancelled { return }

                await MainActor.run {
                    if self.aiSocketTask == nil {
                        self.connectAISocket()
                    }
                }

                let connected = await MainActor.run { self.aiSocketConnected && self.aiSocketTask != nil }
                if connected { return }
            }
        }
    }

    func aiRequestMessages() -> [AIPromptRequest.Message] {
        let visibleMessages = aiMessages.suffix(12).map { message in
            AIPromptRequest.Message(role: message.role.rawValue, content: message.content)
        }
        return [AIPromptRequest.Message(role: "system", content: DesktopAITraining.appParityPrimer)] + visibleMessages
    }

    func receiveAISocketMessages() async {
        guard let socket = aiSocketTask else { return }
        while !Task.isCancelled {
            do {
                let message = try await socket.receive()
                let text: String
                switch message {
                case .string(let value):
                    text = value
                case .data(let data):
                    text = String(data: data, encoding: .utf8) ?? ""
                @unknown default:
                    text = ""
                }
                guard !text.isEmpty else { continue }
                await handleAISocketText(text)
            } catch {
                aiSocketConnected = false
                aiSocketTask = nil
                if !Task.isCancelled {
                    scheduleAISocketReconnect(reason: error.localizedDescription)
                    if aiMessages.contains(where: { $0.isPending && $0.role == .assistant }),
                       let lastUserPrompt = aiMessages.last(where: { $0.role == .user })?.content {
                        Task { [weak self] in
                            await self?.sendFallbackAIChat(lastUserPrompt)
                        }
                    }
                }
                return
            }
        }
    }
}
