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

    func createMailFilter() async {
        guard hasHanasandAuth else {
            mailSummary = "Setup needed."
            append(meta: "Mail filter", body: mailSummary, kind: .error)
            return
        }

        let name = mailFilterName.trimmingCharacters(in: .whitespacesAndNewlines)
        let contains = mailFilterContains.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = mailFilterTargetMailbox.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !contains.isEmpty, !target.isEmpty else {
            mailSummary = "Filter name, match text, and target mailbox are required."
            append(meta: "Mail filter", body: mailSummary, kind: .error)
            return
        }

        do {
            let payload = MailFilterPayload(
                mailboxUser: mailOverview?.mailboxUser,
                name: name,
                enabled: true,
                criteria: .init(field: "from", contains: contains),
                action: .init(type: "move", mailboxName: target, markRead: false)
            )
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/filters"),
                method: "POST",
                body: try JSONEncoder().encode(payload),
                authenticated: true
            )
            mailFilterName = ""
            mailFilterContains = ""
            mailFilterTargetMailbox = ""
            mailSummary = "Created filter \(name)"
            append(meta: "Mail filter created", body: String(text.prefix(240)), kind: .change)
            await loadMailOverview()
        } catch {
            mailSummary = error.localizedDescription
            append(meta: "Mail filter failed", body: error.localizedDescription, kind: .error)
        }
    }

    func deleteMailFilter(_ filter: MailOverviewEnvelope.Filter) async {
        guard hasHanasandAuth else {
            mailSummary = "Setup needed."
            append(meta: "Mail filter", body: mailSummary, kind: .error)
            return
        }

        do {
            var components = URLComponents(url: settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/filters/\(filter.id)"), resolvingAgainstBaseURL: false)
            if let mailboxUser = mailOverview?.mailboxUser, !mailboxUser.isEmpty {
                components?.queryItems = [URLQueryItem(name: "mailboxUser", value: mailboxUser)]
            }
            let text = try await requestPrettyText(
                components?.url ?? settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/filters/\(filter.id)"),
                method: "DELETE",
                authenticated: true
            )
            mailSummary = "Deleted filter \(filter.name)"
            append(meta: "Mail filter deleted", body: text.isEmpty ? filter.name : String(text.prefix(240)), kind: .change)
            await loadMailOverview()
        } catch {
            mailSummary = error.localizedDescription
            append(meta: "Mail filter delete failed", body: error.localizedDescription, kind: .error)
        }
    }

    func createShortcutLink() async {
        let id = linkDraftID.trimmingCharacters(in: .whitespacesAndNewlines)
        let path = linkDraftPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, isValidShortcutDestination(path) else {
            nativeDashboardStatus = "Add a shortcut id and a valid destination."
            append(meta: "Link", body: nativeDashboardStatus, kind: .error)
            return
        }

        do {
            let payload = ShortcutLinkPayload(path: path)
            let created: DashboardShortcutLink = try await requestJSON(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("link/\(id)"),
                method: "POST",
                body: try JSONEncoder().encode(payload)
            )
            linkLookupID = created.id
            linkLookupResult = created
            linkDraftID = ""
            linkDraftPath = ""
            nativeDashboardStatus = "Created /g/\(created.id)"
            append(meta: "Link created", body: "\(created.id) -> \(created.path)", kind: .change)
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Link create failed", body: error.localizedDescription, kind: .error)
        }
    }

    func lookupShortcutLink() async {
        let id = linkLookupID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            nativeDashboardStatus = "Enter a shortcut id first."
            return
        }

        do {
            let link: DashboardShortcutLink = try await requestJSON(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("link/\(id)")
            )
            linkLookupResult = link
            linkDraftID = link.id
            linkDraftPath = link.path
            nativeDashboardStatus = "Loaded /g/\(link.id)"
            append(meta: "Link loaded", body: "\(link.id) -> \(link.path)", kind: .command)
        } catch {
            linkLookupResult = nil
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Link lookup failed", body: error.localizedDescription, kind: .error)
        }
    }

    func updateShortcutLink() async {
        let id = (linkLookupResult?.id ?? linkDraftID).trimmingCharacters(in: .whitespacesAndNewlines)
        let path = linkDraftPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, isValidShortcutDestination(path) else {
            nativeDashboardStatus = "Load a shortcut and enter a valid destination."
            append(meta: "Link update", body: nativeDashboardStatus, kind: .error)
            return
        }

        do {
            let payload = ShortcutLinkPayload(path: path)
            let updated: DashboardShortcutLink = try await requestJSON(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("link/\(id)"),
                method: "PUT",
                body: try JSONEncoder().encode(payload)
            )
            linkLookupResult = updated
            linkLookupID = updated.id
            nativeDashboardStatus = "Updated /g/\(updated.id)"
            append(meta: "Link updated", body: "\(updated.id) -> \(updated.path)", kind: .change)
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Link update failed", body: error.localizedDescription, kind: .error)
        }
    }

    func loadAiModels() async {
        do {
            let models: AIModelsEnvelope = try await requestJSON(
                settings.apiBaseURL.normalizedBaseURL.appendingPathComponent("ai/models"),
                authenticated: hasHanasandAuth
            )
            let connected = models.connected.map { client in
                AIConnectedClient(
                    rawID: client.id,
                    name: client.name,
                    lastSeen: nil,
                    model: client.model
                )
            }
            aiClients = connected.sortedForRuntime
            let names = aiClients.map(\.name).filter { !$0.isEmpty }
            aiSummary = names.isEmpty ? "No connected models" : names.joined(separator: ", ")
            append(meta: "Hanasand AI", body: aiSummary, kind: names.isEmpty ? .error : .command)
        } catch {
            aiSummary = error.localizedDescription
            append(meta: "Hanasand AI", body: error.localizedDescription, kind: .error)
        }
    }
}
