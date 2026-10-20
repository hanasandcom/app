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

    func saveNoteDraft() async {
        let title = noteDraftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let content = noteDraftContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty || !content.isEmpty else {
            nativeDashboardStatus = "Write something first."
            return
        }

        let payload = ["title": title, "content": content, "source": "desktop"]
        let body = (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)
        let isUpdate = !selectedNoteID.isEmpty
        let path = isUpdate ? "notes/\(selectedNoteID)" : "notes"
        let method = isUpdate ? "PUT" : "POST"

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath(path),
                method: method,
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Saved note."
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func deleteSelectedNote() async {
        guard !selectedNoteID.isEmpty else { return }
        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("notes/\(selectedNoteID)"),
                method: "DELETE",
                authenticated: true
            )
            nativeDashboardStatus = "Deleted note."
            selectedNoteID = ""
            noteDraftTitle = ""
            noteDraftContent = ""
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func loadSelectedNoteIntoDraft() {
        guard let selected = notes.first(where: { $0.id == selectedNoteID }) else {
            noteDraftTitle = ""
            noteDraftContent = ""
            return
        }
        noteDraftTitle = selected.title
        noteDraftContent = selected.content
    }

    func createNativeShare() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let name = shareDraftName.trimmingCharacters(in: .whitespacesAndNewlines)
        let content = shareDraftContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else {
            nativeDashboardStatus = "Add share content first."
            return
        }

        let id = "desktop-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).lowercased())"
        let normalizedName = name.isEmpty ? "desktop-share-\(id.suffix(6))" : name
        let payload = CreateSharePayload(
            id: id,
            includeTree: true,
            name: normalizedName,
            path: normalizedName.slugifiedPath,
            content: content,
            parent: nil,
            type: "share"
        )
        let body = (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Creating share"
        defer { isLoadingNativeDashboard = false }

        do {
            let text = try await requestPrettyText(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("share"),
                method: "POST",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Created \(normalizedName)"
            nativeDashboardPayload = text
            shareDraftName = ""
            shareDraftContent = ""
            append(meta: "Share created", body: normalizedName, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Share failed", body: error.localizedDescription, kind: .error)
        }
    }

    func openShare(_ share: DashboardShare) {
        let target = share.path?.trimmingCharacters(in: .whitespacesAndNewlines)
        openWebsite(path: "/s/\((target?.isEmpty == false ? target : share.id) ?? share.id)", label: share.displayName)
    }

    func loadShareIntoEditor(_ share: DashboardShare) {
        selectedShareID = share.id
        shareEditName = share.name ?? ""
        shareEditPath = share.path ?? ""
        shareEditContent = share.content ?? ""
        nativeDashboardStatus = "Editing \(share.displayName)"
    }

    func updateSelectedShare() async {
        guard !selectedShareID.isEmpty else {
            nativeDashboardStatus = "Select a share first."
            return
        }
        let body = (try? JSONEncoder().encode([
            "name": shareEditName.trimmingCharacters(in: .whitespacesAndNewlines),
            "path": shareEditPath.trimmingCharacters(in: .whitespacesAndNewlines),
            "content": shareEditContent,
        ])) ?? Data("{}".utf8)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Updating share"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("share/\(selectedShareID)"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Updated share."
            append(meta: "Share updated", body: selectedShareID, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func toggleNativeShareLock(_ share: DashboardShare) async {
        isLoadingNativeDashboard = true
        nativeDashboardStatus = share.locked == true ? "Unlocking share" : "Locking share"
        defer { isLoadingNativeDashboard = false }

        do {
            let locked = share.locked != true
            _ = try await requestPrettyText(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("share/lock/\(share.id)"),
                method: "PUT",
                body: try JSONSerialization.data(withJSONObject: ["locked": locked]),
                authenticated: true
            )
            nativeDashboardStatus = locked ? "Locked share." : "Unlocked share."
            append(meta: locked ? "Share locked" : "Share unlocked", body: share.id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }
}
