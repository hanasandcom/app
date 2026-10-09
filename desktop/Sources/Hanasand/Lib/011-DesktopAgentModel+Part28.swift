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

    func updateTypedDashboardState(from text: String, path: String) {
        guard let data = text.data(using: .utf8) else { return }
        let decoder = JSONDecoder()
        switch path {
        case "/dashboard":
            serviceStatus = try? decoder.decode(DashboardServiceStatus.self, from: data)
        case "/db":
            databaseOverview = try? decoder.decode(DashboardDatabaseOverview.self, from: data)
        case "/mail":
            if let overview = try? decoder.decode(MailOverviewEnvelope.self, from: data) {
                mailOverview = overview
                selectedMailAccountUser = overview.mailboxUser ?? selectedMailAccountUser
                selectedMailboxID = overview.selectedMailboxId ?? selectedMailboxID
                selectedMailMessageID = overview.selectedMessage?.id ?? overview.messages.first?.id ?? selectedMailMessageID
                mailSummary = "\(overview.messages.count) messages · \(overview.mailboxes.count) mailboxes"
            }
        case "/db/backups":
            backupServices = (try? decoder.decode([DashboardBackupService].self, from: data)) ?? []
        case "/db/restore":
            backupFiles = (try? decoder.decode([DashboardBackupFile].self, from: data)) ?? []
        case "/notes":
            notes = (try? decoder.decode([DashboardNote].self, from: data)) ?? []
            if selectedNoteID.isEmpty || !notes.contains(where: { $0.id == selectedNoteID }) {
                selectedNoteID = notes.first?.id ?? ""
            }
            loadSelectedNoteIntoDraft()
        case "/s":
            shares = (try? decoder.decode([DashboardShare].self, from: data)) ?? []
        case "/content/articles":
            articles = (try? decoder.decode([DashboardArticle].self, from: data)) ?? []
            if selectedArticleID.isEmpty || !articles.contains(where: { $0.id == selectedArticleID }) {
                selectedArticleID = articles.first?.id ?? ""
                if let article = articles.first {
                    loadArticleIntoEditor(article)
                }
            }
        case "/content/thoughts":
            thoughts = (try? decoder.decode([DashboardThought].self, from: data)) ?? []
            if selectedThoughtID.isEmpty || !thoughts.contains(where: { $0.id == selectedThoughtID }) {
                selectedThoughtID = thoughts.first?.id ?? ""
                if let thought = thoughts.first {
                    loadThoughtIntoEditor(thought)
                }
            }
        case "/system/ai":
            if let envelope = try? decoder.decode(AIModelsEnvelope.self, from: data) {
                aiClients = envelope.connected.map { client in
                    AIConnectedClient(
                        rawID: client.id,
                        name: client.name,
                        lastSeen: client.lastSeen,
                        model: client.model
                    )
                }.sortedForRuntime
            }
        case "/profile":
            profile = try? decoder.decode(DashboardProfile.self, from: data)
        case "/users", "/management":
            users = (try? decoder.decode([DashboardUser].self, from: data)) ?? []
            if selectedUserID.isEmpty || !users.contains(where: { $0.id == selectedUserID }) {
                selectedUserID = users.first?.id ?? ""
            }
        case "/role":
            roles = (try? decoder.decode([DashboardRole].self, from: data)) ?? []
            if selectedRoleID.isEmpty || !roles.contains(where: { $0.id == selectedRoleID }) {
                selectedRoleID = roles.first?.id ?? ""
                if let role = roles.first {
                    loadRoleIntoEditor(role)
                }
            }
        case "/logs":
            if let envelope = try? decoder.decode(DashboardLogsEnvelope.self, from: data) {
                logs = envelope.logs
            } else {
                logs = (try? decoder.decode([DashboardLogEntry].self, from: data)) ?? []
            }
        case "/system":
            if let envelope = try? decoder.decode(DashboardDockerEnvelope.self, from: data) {
                dockerContainers = envelope.resolvedContainers
            } else {
                dockerContainers = (try? decoder.decode([DashboardDockerContainer].self, from: data)) ?? []
            }
        case "/vms":
            if let envelope = try? decoder.decode(DashboardVMEnvelope.self, from: data) {
                virtualMachines = envelope.resolvedVMs
            } else {
                virtualMachines = (try? decoder.decode([DashboardVM].self, from: data)) ?? []
            }
        case "/dashboard/tests":
            recentTests = (try? decoder.decode([DashboardRecentTest].self, from: data)) ?? []
        case "/vulnerabilities":
            vulnerabilityReport = try? decoder.decode(DashboardVulnerabilityReport.self, from: data)
        case "/traffic":
            trafficMetrics = try? decoder.decode(DashboardTrafficMetrics.self, from: data)
        case "/system/rates":
            rateLimitOverview = try? decoder.decode(DashboardRateLimitOverview.self, from: data)
        default:
            break
        }
    }

    func validateHTTP(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw DashboardRequestError.httpStatus(http.statusCode)
        }
    }

    var realProjects: [ProjectItem] {
        let saved = customProjectTitles.map { ProjectItem(title: $0, state: selectedProject == $0 ? .active : .normal) }
        return [
            .folder("Current"),
            .init(title: URL(fileURLWithPath: status.cwd).lastPathComponent, state: status.ok ? .live : .normal),
        ] + saved
    }

    func createProject() {
        let base = "Project"
        var index = customProjectTitles.count + 1
        var title = "\(base) \(index)"
        while customProjectTitles.contains(title) {
            index += 1
            title = "\(base) \(index)"
        }
        customProjectTitles.append(title)
        selectedProject = title
        selectedSection = .command
        append(meta: "Project", body: "Created \(title).", kind: .change)
    }

    func reviewChangedFiles() {
        selectedSection = .ide
        refreshChangedFilesSummary()
    }
}
