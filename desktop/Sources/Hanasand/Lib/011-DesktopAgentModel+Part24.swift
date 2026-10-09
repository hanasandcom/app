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

    func revokeProfileSession(_ session: DashboardAuthSession) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Revoking session"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/sessions/\(session.tokenID)"),
                method: "DELETE",
                authenticated: true
            )
            nativeDashboardStatus = "Revoked session \(session.tokenID)"
            append(meta: "Session revoked", body: "\(session.deviceLabel) · \(session.ip ?? "unknown IP")", kind: .change)
            await loadProfileSecurityData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Session revoke failed", body: error.localizedDescription, kind: .error)
        }
    }

    func revokeOtherProfileSessions() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Revoking other sessions"
        defer { isLoadingNativeDashboard = false }

        do {
            let body = (try? JSONEncoder().encode(["keep_current": true])) ?? Data("{}".utf8)
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/sessions/revoke"),
                method: "POST",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Revoked other sessions"
            append(meta: "Sessions revoked", body: String(text.prefix(240)), kind: .change)
            await loadProfileSecurityData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Session revoke failed", body: error.localizedDescription, kind: .error)
        }
    }

    func deleteProfileCertificate(_ certificate: DashboardCertificate) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Deleting certificate"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("certificates/\(certificate.id)"),
                method: "DELETE",
                authenticated: true
            )
            nativeDashboardStatus = "Deleted certificate \(certificate.name)"
            append(meta: "Certificate deleted", body: certificate.name, kind: .change)
            await loadProfileSecurityData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Certificate delete failed", body: error.localizedDescription, kind: .error)
        }
    }

    func restartDockerContainer(_ container: DashboardDockerContainer) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Restarting \(container.displayName)"
        defer { isLoadingNativeDashboard = false }

        do {
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("restart/\(container.id)"),
                authenticated: true
            )
            nativeDashboardStatus = "Restart requested for \(container.displayName)"
            append(meta: "Docker restart", body: text.isEmpty ? container.id : String(text.prefix(240)), kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Docker restart failed", body: error.localizedDescription, kind: .error)
        }
    }

    func runVirtualMachineAction(_ vm: DashboardVM, action: String) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            append(meta: "VM action failed", body: nativeDashboardStatus, kind: .error)
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "\(action.capitalized) \(vm.name)"
        defer { isLoadingNativeDashboard = false }

        do {
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("vm/\(vm.name)/\(action)"),
                method: "POST",
                authenticated: true
            )
            nativeDashboardStatus = "\(action.capitalized) requested for \(vm.name)"
            append(meta: "VM \(action)", body: text.isEmpty ? vm.name : String(text.prefix(240)), kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "VM \(action) failed", body: error.localizedDescription, kind: .error)
        }
    }

    func chooseUploadFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.image, .movie, .pdf, .plainText, .json, .data]

        guard panel.runModal() == .OK, let url = panel.url else {
            uploadStatus = "File selection cancelled."
            return
        }

        selectUploadFile(url)
    }

    func selectUploadFile(_ url: URL) {
        uploadFileURL = url
        uploadName = url.lastPathComponent
        uploadType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        if uploadPath.isEmpty {
            uploadPath = url.deletingPathExtension().lastPathComponent.slugifiedPath
        }
        uploadPathAvailable = nil
        uploadedFileURL = ""
        uploadStatus = "Ready to upload \(url.lastPathComponent)."
    }

    func resetUploadDraft() {
        uploadFileURL = nil
        uploadName = ""
        uploadDescription = ""
        uploadPath = ""
        uploadType = "application/octet-stream"
        uploadPathAvailable = nil
        uploadedFileURL = ""
        uploadStatus = "Choose a file to upload to the CDN."
    }
}
