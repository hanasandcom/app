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

    func revealExportedDocument() {
        guard !exportedDocumentPath.isEmpty else {
            documentStatus = "No exported PDF yet."
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: exportedDocumentPath)])
    }

    func importImagesForReview() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.image]
        guard panel.runModal() == .OK else { return }

        importImagesForReview(urls: panel.urls)
    }

    func importImagesForReview(urls: [URL]) {
        imageReviewItems = urls.compactMap { url in
            guard let image = NSImage(contentsOf: url) else { return nil }
            return DesktopImageReviewItem(url: url, image: image)
        }
        imageReviewIndex = 0
        imageReviewDecisions = [:]
        imageReviewHistory = []
        imageReviewStatus = imageReviewItems.isEmpty ? "No images imported." : "Imported \(imageReviewItems.count) images."
    }

    func importImageProviders(_ providers: [NSItemProvider]) -> Bool {
        importFileProviders(providers) { [weak self] urls in
            self?.selectedSection = .images
            self?.importImagesForReview(urls: urls)
        }
        return !providers.isEmpty
    }

    var currentImageReviewItem: DesktopImageReviewItem? {
        guard imageReviewItems.indices.contains(imageReviewIndex) else { return nil }
        return imageReviewItems[imageReviewIndex]
    }

    func revealCurrentImage() {
        guard let current = currentImageReviewItem else {
            imageReviewStatus = "No current image."
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([current.url])
    }

    func copyCurrentImagePath() {
        guard let current = currentImageReviewItem else {
            imageReviewStatus = "No current image."
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(current.url.path, forType: .string)
        imageReviewStatus = "Copied \(current.title)."
    }

    func decideCurrentImage(_ decision: ImageReviewDecision) {
        guard let current = currentImageReviewItem else { return }
        imageReviewDecisions[current.id] = decision
        imageReviewHistory.append(current.id)
        imageReviewIndex = min(imageReviewIndex + 1, imageReviewItems.count)
        imageReviewStatus = decision == .keep ? "Kept \(current.title)." : "Marked \(current.title) for deletion."
    }

    func undoImageDecision() {
        guard let last = imageReviewHistory.popLast() else {
            imageReviewStatus = "Nothing to undo."
            return
        }
        imageReviewDecisions.removeValue(forKey: last)
        imageReviewIndex = max(imageReviewIndex - 1, 0)
        imageReviewStatus = "Undid last image decision."
    }

    func restartImageReview() {
        imageReviewIndex = 0
        imageReviewDecisions = [:]
        imageReviewHistory = []
        imageReviewStatus = imageReviewItems.isEmpty ? "Import images to start review." : "Restarted review for \(imageReviewItems.count) images."
    }

    func trashDiscardedImages() {
        let discarded = imageReviewItems.filter { imageReviewDecisions[$0.id] == .discard }
        guard !discarded.isEmpty else {
            imageReviewStatus = "No images marked for deletion."
            return
        }

        var failed: [String] = []
        for item in discarded {
            do {
                var resultingURL: NSURL?
                try FileManager.default.trashItem(at: item.url, resultingItemURL: &resultingURL)
            } catch {
                failed.append(item.title)
            }
        }

        let discardedIDs = Set(discarded.map(\.id))
        imageReviewItems.removeAll { discardedIDs.contains($0.id) }
        imageReviewDecisions = imageReviewDecisions.filter { !discardedIDs.contains($0.key) }
        imageReviewHistory.removeAll { discardedIDs.contains($0) }
        imageReviewIndex = min(imageReviewIndex, imageReviewItems.count)
        imageReviewStatus = failed.isEmpty
            ? "Moved \(discarded.count) image\(discarded.count == 1 ? "" : "s") to Trash."
            : "Moved some images to Trash. Failed: \(failed.prefix(3).joined(separator: ", "))"
    }

    func createMailMailbox() async {
        guard hasHanasandAuth else {
            mailSummary = "Setup needed."
            append(meta: "Mailbox", body: mailSummary, kind: .error)
            return
        }

        let name = mailNewMailboxName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            mailSummary = "Mailbox name is required."
            append(meta: "Mailbox", body: mailSummary, kind: .error)
            return
        }

        do {
            let payload = MailMailboxPayload(mailboxUser: mailOverview?.mailboxUser, name: name, parentId: nil)
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/mailboxes"),
                method: "POST",
                body: try JSONEncoder().encode(payload),
                authenticated: true
            )
            mailNewMailboxName = ""
            mailSummary = "Created mailbox \(name)"
            append(meta: "Mailbox created", body: String(text.prefix(240)), kind: .change)
            await loadMailOverview()
        } catch {
            mailSummary = error.localizedDescription
            append(meta: "Mailbox failed", body: error.localizedDescription, kind: .error)
        }
    }
}
