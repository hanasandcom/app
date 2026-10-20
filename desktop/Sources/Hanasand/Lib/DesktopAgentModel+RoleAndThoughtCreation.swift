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

    func createNativeRole() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let name = roleDraftName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            nativeDashboardStatus = "Write a role name first."
            return
        }

        let explicitID = roleDraftID.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = explicitID.isEmpty ? name.slugifiedPath : explicitID.slugifiedPath
        let payload = [
            "id": id,
            "name": name,
            "description": roleDraftDescription.trimmingCharacters(in: .whitespacesAndNewlines),
            "created_by": userIDForRequests,
        ]
        let body = (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Creating role"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("role"),
                method: "POST",
                body: body,
                authenticated: true
            )
            roleDraftID = ""
            roleDraftName = ""
            roleDraftDescription = ""
            nativeDashboardStatus = "Created \(id)"
            append(meta: "Role created", body: id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Role create failed", body: error.localizedDescription, kind: .error)
        }
    }

    func updateSelectedRole() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let name = roleEditName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedRoleID.isEmpty else {
            nativeDashboardStatus = "Select a role first."
            return
        }
        guard !name.isEmpty else {
            nativeDashboardStatus = "Role name cannot be empty."
            return
        }

        let payload = [
            "name": name,
            "description": roleEditDescription.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        let body = (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Saving role"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("role/\(selectedRoleID)"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Saved \(selectedRoleID)"
            append(meta: "Role saved", body: selectedRoleID, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Role save failed", body: error.localizedDescription, kind: .error)
        }
    }

    func deleteNativeRole(_ role: DashboardRole) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Deleting role"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("role/\(role.id)"),
                method: "DELETE",
                authenticated: true
            )
            if selectedRoleID == role.id {
                selectedRoleID = ""
                roleEditName = ""
                roleEditDescription = ""
            }
            nativeDashboardStatus = "Deleted \(role.id)"
            append(meta: "Role deleted", body: role.id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Role delete failed", body: error.localizedDescription, kind: .error)
        }
    }

    func createNativeThought() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let title = thoughtDraftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            nativeDashboardStatus = "Write a thought title first."
            return
        }

        let payload = ["title": title, "id": userIDForRequests]
        let body = (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Creating thought"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("thoughts"),
                method: "POST",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Created thought"
            thoughtDraftTitle = ""
            append(meta: "Thought created", body: title, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Thought failed", body: error.localizedDescription, kind: .error)
        }
    }

    func loadThoughtIntoEditor(_ thought: DashboardThought) {
        selectedThoughtID = thought.id
        thoughtEditTitle = thought.title
    }
}
