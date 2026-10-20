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

    func copyUploadedFileURL() {
        guard !uploadedFileURL.isEmpty else {
            uploadStatus = "No uploaded URL to copy yet."
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(uploadedFileURL, forType: .string)
        uploadStatus = "Copied uploaded file URL."
        append(meta: "Upload", body: "Copied \(uploadedFileURL)", kind: .command)
    }

    func openUploadedFileURL() {
        guard let url = URL(string: uploadedFileURL), !uploadedFileURL.isEmpty else {
            uploadStatus = "No uploaded URL to open yet."
            return
        }
        NSWorkspace.shared.open(url)
        uploadStatus = "Opened uploaded file."
        append(meta: "Upload", body: url.absoluteString, kind: .command)
    }

    func selectUploadProviders(_ providers: [NSItemProvider]) -> Bool {
        importFileProviders(providers) { [weak self] urls in
            guard let first = urls.first else { return }
            self?.selectUploadFile(first)
        }
        return !providers.isEmpty
    }

    func checkUploadPath() async {
        let safePath = uploadPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !safePath.isEmpty else {
            uploadPathAvailable = nil
            uploadStatus = "Custom path is optional. Leave it blank to use the generated file id."
            return
        }

        isCheckingUploadPath = true
        defer { isCheckingUploadPath = false }

        do {
            var components = URLComponents(url: settings.cdnBaseURL.normalizedBaseURL.appendingPathComponent("files/check"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "path", value: safeUploadPathWithExtension())]
            let text = try await requestPrettyText(components?.url ?? settings.cdnBaseURL.normalizedBaseURL.appendingPathComponent("files/check"))
            let exists = text.localizedCaseInsensitiveContains(#""exists": true"#) || text.localizedCaseInsensitiveContains(#""exists":true"#)
            uploadPathAvailable = !exists
            uploadStatus = exists ? "That path is already taken." : "Path is available."
        } catch {
            uploadPathAvailable = false
            uploadStatus = "Could not check path: \(error.localizedDescription)"
        }
    }

    func uploadSelectedFile() async {
        guard let fileURL = uploadFileURL else {
            uploadStatus = "Choose a file first."
            return
        }

        if uploadPathAvailable == false {
            uploadStatus = "Choose an available path before uploading."
            return
        }

        isUploadingFile = true
        defer { isUploadingFile = false }

        do {
            let boundary = "Boundary-\(UUID().uuidString)"
            let body = try multipartUploadBody(fileURL: fileURL, boundary: boundary)
            var request = URLRequest(url: settings.cdnBaseURL.normalizedBaseURL.appendingPathComponent("files"))
            request.httpMethod = "POST"
            request.timeoutInterval = 90
            request.httpBody = body
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")

            let (data, response) = try await URLSession.shared.data(for: request)
            try validateHTTP(response)
            let uploaded = try JSONDecoder().decode(UploadedFileResponse.self, from: data)
            let destination = uploadedURL(for: uploaded)
            uploadedFileURL = destination
            uploadStatus = "Uploaded \(uploadName) successfully."
            append(meta: "Upload", body: destination, kind: .change)
        } catch {
            uploadStatus = "Upload failed: \(error.localizedDescription)"
            append(meta: "Upload", body: error.localizedDescription, kind: .error)
        }
    }

    func safeUploadPathWithExtension() -> String {
        let safePath = uploadPath.slugifiedPath
        let ext = uploadFileURL?.pathExtension.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !ext.isEmpty, !safePath.lowercased().hasSuffix(".\(ext.lowercased())") else { return safePath }
        return "\(safePath).\(ext.lowercased())"
    }

    func uploadedURL(for uploaded: UploadedFileResponse) -> String {
        let base = settings.cdnBaseURL.normalizedBaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if !uploadPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "\(base)/files/path/\(uploadPath.slugifiedPath)"
        }
        return "\(base)/files/\(uploaded.id)"
    }

    func multipartUploadBody(fileURL: URL, boundary: String) throws -> Data {
        var body = Data()
        let fileData = try Data(contentsOf: fileURL)
        let fields: [(String, String)] = [
            ("name", uploadName.isEmpty ? fileURL.lastPathComponent : uploadName),
            ("description", uploadDescription),
            ("path", uploadPath.isEmpty ? "" : uploadPath.slugifiedPath),
            ("type", uploadType.isEmpty ? "application/octet-stream" : uploadType),
        ].filter { !$0.1.isEmpty }

        for (name, value) in fields {
            body.appendMultipartBoundary(boundary)
            body.appendUTF8("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            body.appendUTF8("\(value)\r\n")
        }

        body.appendMultipartBoundary(boundary)
        body.appendUTF8("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n")
        body.appendUTF8("Content-Type: \(uploadType.isEmpty ? "application/octet-stream" : uploadType)\r\n\r\n")
        body.append(fileData)
        body.appendUTF8("\r\n")
        body.appendUTF8("--\(boundary)--\r\n")
        return body
    }

    func runNativeDashboardMutation(_ mutation: NativeDashboardMutation) async {
        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Running \(mutation.label)"
        defer { isLoadingNativeDashboard = false }

        do {
            let text = try await requestPrettyText(
                mutation.baseURL(settings: settings).appendingAPIPath(mutation.path),
                method: "POST",
                body: mutation.body,
                authenticated: true,
                userAgent: mutation.userAgent
            )
            nativeDashboardStatus = text.isEmpty ? "Completed \(mutation.label)" : String(text.prefix(240))
            append(meta: mutation.label, body: nativeDashboardStatus, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: mutation.label, body: error.localizedDescription, kind: .error)
        }
    }

    func append(meta: String, body: String, kind: AgentEvent.Kind = .note) {
        events.append(AgentEvent(meta: meta, body: body, kind: kind))
        if events.count > 80 {
            events.removeFirst(events.count - 80)
        }
    }
}
