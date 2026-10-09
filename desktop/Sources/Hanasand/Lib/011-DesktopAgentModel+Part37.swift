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
    func fetchDesktopAutomations() async throws -> [DesktopAutomation] {
        let envelope: DesktopAutomationEnvelope = try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("automations"),
            authenticated: true
        )
        return envelope.automations
    }

    func fetchDesktopAutomationDetail(_ id: String) async throws -> DesktopAutomationDetailEnvelope {
        let safeID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("automations/\(safeID)"),
            authenticated: true
        )
    }

    func saveDesktopAutomation(_ payload: DesktopAutomationPayload, id: String? = nil) async throws -> DesktopAutomation {
        let body = try JSONEncoder().encode(payload)
        let path: String
        let method: String
        if let id {
            let safeID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
            path = "automations/\(safeID)"
            method = "PUT"
        } else {
            path = "automations"
            method = "POST"
        }
        let envelope: DesktopAutomationMutationEnvelope = try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath(path),
            method: method,
            body: body,
            authenticated: true
        )
        return envelope.automation
    }

    func setDesktopAutomationStatus(_ id: String, status: String) async throws {
        let safeID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let body = try JSONEncoder().encode(DesktopAutomationStatusPayload(status: status))
        let _: DesktopAutomationMutationEnvelope = try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("automations/\(safeID)"),
            method: "PUT",
            body: body,
            authenticated: true
        )
    }

    func deleteDesktopAutomation(_ id: String) async throws {
        let safeID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let _: DesktopAutomationMutationEnvelope = try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("automations/\(safeID)"),
            method: "DELETE",
            authenticated: true
        )
    }

    func runDesktopAutomation(_ id: String) async throws -> String {
        let safeID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let envelope: DesktopAutomationRunNowEnvelope = try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("automations/\(safeID)/run"),
            method: "POST",
            authenticated: true
        )
        return envelope.message ?? "Run started."
    }

    func fetchDesktopCronJobs() async throws -> DesktopCronJobsEnvelope {
        try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("system/cron"),
            authenticated: true
        )
    }

    func updateDesktopCronJob(_ id: String, payload: DesktopCronUpdatePayload) async throws -> DesktopCronJobsEnvelope {
        let safeID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let body = try JSONEncoder().encode(payload)
        let envelope: DesktopCronUpdateEnvelope = try await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("system/cron/\(safeID)"),
            method: "PUT",
            body: body,
            authenticated: true
        )
        return DesktopCronJobsEnvelope(jobs: envelope.jobs, ready: true)
    }
}

struct DesktopAutomationMutationEnvelope: Decodable {
    let automation: DesktopAutomation
}

struct DesktopAutomationStatusPayload: Encodable {
    let status: String
}

struct DesktopAutomationRunNowEnvelope: Decodable {
    let message: String?
}

struct DesktopCronUpdateEnvelope: Decodable {
    let job: DesktopCronJob
    let jobs: [DesktopCronJob]
}
