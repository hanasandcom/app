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

    func updateSelectedThought() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let title = thoughtEditTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedThoughtID.isEmpty else {
            nativeDashboardStatus = "Select a thought first."
            return
        }
        guard !title.isEmpty else {
            nativeDashboardStatus = "Thought title cannot be empty."
            return
        }

        let body = (try? JSONEncoder().encode(["title": title])) ?? Data("{}".utf8)
        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Saving thought"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("thought/\(selectedThoughtID)"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Saved thought"
            append(meta: "Thought saved", body: selectedThoughtID, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Thought save failed", body: error.localizedDescription, kind: .error)
        }
    }

    func deleteSelectedThought(_ thought: DashboardThought) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Deleting thought"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("thought/\(thought.id)"),
                method: "DELETE",
                authenticated: true
            )
            if selectedThoughtID == thought.id {
                selectedThoughtID = ""
                thoughtEditTitle = ""
            }
            nativeDashboardStatus = "Deleted thought"
            append(meta: "Thought deleted", body: thought.id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Thought delete failed", body: error.localizedDescription, kind: .error)
        }
    }

    func createNativeLoadTest() async {
        let rawTarget = testDraftURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawTarget.isEmpty else {
            nativeDashboardStatus = "Add a URL to test first."
            return
        }
        let target = rawTarget.contains("://") ? rawTarget : "https://\(rawTarget)"
        guard let scheme = URL(string: target)?.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            nativeDashboardStatus = "Load tests need an http or https URL."
            return
        }

        let timeout = Int(testDraftTimeout.trimmingCharacters(in: .whitespacesAndNewlines))
        let payload = CreateLoadTestPayload(
            url: target,
            timeout: timeout,
            stages: parseLoadTestStages(testDraftStages)
        )
        let body = (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Creating load test"
        defer { isLoadingNativeDashboard = false }

        do {
            let created: DashboardRecentTest = try await requestJSON(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("test"),
                method: "POST",
                body: body,
                authenticated: hasHanasandAuth
            )
            selectedTestDetail = created
            testDraftURL = ""
            nativeDashboardStatus = "Created test \(created.id). Starting run."
            append(meta: "Load test created", body: created.displayURL, kind: .change)
            await rerunLoadTest(created)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Load test failed", body: error.localizedDescription, kind: .error)
        }
    }

    func rerunLoadTest(_ test: DashboardRecentTest) async {
        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Starting test \(test.id)"
        defer { isLoadingNativeDashboard = false }

        do {
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("test/\(test.id)/rerun"),
                method: "POST",
                body: Data("{}".utf8),
                authenticated: hasHanasandAuth
            )
            nativeDashboardStatus = text.isEmpty ? "Started test \(test.id)." : String(text.prefix(180))
            append(meta: "Load test rerun", body: test.id, kind: .change)
            await loadLoadTestDetail(test)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Load test rerun failed", body: error.localizedDescription, kind: .error)
        }
    }

    func loadLoadTestDetail(_ test: DashboardRecentTest) async {
        do {
            selectedTestDetail = try await requestJSON(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("test/\(test.id)"),
                authenticated: false
            )
            nativeDashboardStatus = "Loaded test \(test.id)."
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func copyLoadTestLink(_ test: DashboardRecentTest) {
        let url = settings.websiteBaseURL.normalizedBaseURL.appendingPathComponent("test/\(test.id)").absoluteString
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
        nativeDashboardStatus = "Copied \(url)"
    }

    func parseLoadTestStages(_ rawValue: String) -> [LoadTestStagePayload]? {
        let stages = rawValue
            .split(separator: ",")
            .compactMap { segment -> LoadTestStagePayload? in
                let parts = segment.split(separator: ":", maxSplits: 1).map {
                    String($0).trimmingCharacters(in: .whitespacesAndNewlines)
                }
                guard parts.count == 2, let target = Int(parts[1]), !parts[0].isEmpty else {
                    return nil
                }
                return LoadTestStagePayload(duration: parts[0], target: target)
            }
        return stages.isEmpty ? nil : stages
    }
}
