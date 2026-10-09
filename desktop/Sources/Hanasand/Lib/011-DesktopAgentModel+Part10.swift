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

    func addMailAttachment() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        guard panel.runModal() == .OK else { return }

        for url in panel.urls {
            do {
                let data = try Data(contentsOf: url)
                let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                mailDraftAttachments.append(MailDraftAttachment(name: url.lastPathComponent, type: type, size: data.count, contentBase64: data.base64EncodedString()))
            } catch {
                append(meta: "Attachment failed", body: error.localizedDescription, kind: .error)
            }
        }
        mailSummary = "\(mailDraftAttachments.count) attachment\(mailDraftAttachments.count == 1 ? "" : "s") ready"
    }

    func removeMailAttachment(_ attachment: MailDraftAttachment) {
        mailDraftAttachments.removeAll { $0.id == attachment.id }
    }

    func downloadMailAttachment(_ attachment: MailOverviewEnvelope.Attachment, from message: MailOverviewEnvelope.Message) async {
        guard let mailboxUser = mailOverview?.mailboxUser else { return }
        do {
            let url = settings.apiBaseURL.normalizedBaseURL
                .appendingAPIPath("mail/blob/\(mailboxUser)/\(attachment.blobId)/\(attachment.name)")
            let (data, response) = try await URLSession.shared.data(for: request(url, authenticated: true))
            try validateHTTP(response)
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("hanasand-mail-\(message.id)")
                .appendingPathComponent(attachment.name)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: destination, options: [.atomic])
            NSWorkspace.shared.open(destination)
            mailSummary = "Opened \(attachment.name)"
        } catch {
            mailSummary = "Attachment failed: \(error.localizedDescription)"
            append(meta: "Attachment failed", body: error.localizedDescription, kind: .error)
        }
    }

    func importDocumentPages() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.pdf, .image]
        guard panel.runModal() == .OK else { return }

        importDocumentURLs(panel.urls)
    }

    func importDocumentURLs(_ urls: [URL]) {
        var imported = 0
        for url in urls {
            if url.pathExtension.lowercased() == "pdf", let pdf = PDFDocument(url: url) {
                for index in 0..<pdf.pageCount {
                    guard let page = pdf.page(at: index) else { continue }
                    let bounds = page.bounds(for: .mediaBox)
                    let image = NSImage(size: bounds.size)
                    image.lockFocus()
                    NSColor.white.setFill()
                    bounds.fill()
                    page.draw(with: .mediaBox, to: NSGraphicsContext.current!.cgContext)
                    image.unlockFocus()
                    documentPages.append(DesktopDocumentPage(title: "\(url.deletingPathExtension().lastPathComponent) p\(index + 1)", image: image, sourceURL: url))
                    imported += 1
                }
            } else if let image = NSImage(contentsOf: url) {
                documentPages.append(DesktopDocumentPage(title: url.lastPathComponent, image: image, sourceURL: url))
                imported += 1
            }
        }
        documentStatus = imported == 0 ? "No supported pages imported." : "Imported \(imported) page\(imported == 1 ? "" : "s")."
    }

    func importDocumentProviders(_ providers: [NSItemProvider]) -> Bool {
        importFileProviders(providers) { [weak self] urls in
            self?.selectedSection = .documents
            self?.importDocumentURLs(urls)
        }
        return !providers.isEmpty
    }

    func moveDocumentPage(_ page: DesktopDocumentPage, direction: Int) {
        guard let index = documentPages.firstIndex(where: { $0.id == page.id }) else { return }
        let target = index + direction
        guard documentPages.indices.contains(target) else { return }
        documentPages.swapAt(index, target)
    }

    func removeDocumentPage(_ page: DesktopDocumentPage) {
        documentPages.removeAll { $0.id == page.id }
        documentStatus = "Removed \(page.title)."
    }

    func revealDocumentPageSource(_ page: DesktopDocumentPage) {
        guard let sourceURL = page.sourceURL else {
            documentStatus = "No source file tracked for \(page.title)."
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([sourceURL])
    }

    func copyDocumentPageTitle(_ page: DesktopDocumentPage) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(page.title, forType: .string)
        documentStatus = "Copied \(page.title)."
    }

    func rotateDocumentPage(_ page: DesktopDocumentPage, clockwise: Bool = true) {
        guard let index = documentPages.firstIndex(where: { $0.id == page.id }),
              let rotated = documentPages[index].image.rotated(clockwise: clockwise) else {
            documentStatus = "Could not rotate \(page.title)."
            return
        }
        documentPages[index].image = rotated
        documentStatus = "Rotated \(page.title)."
    }

    func clearDocumentPages() {
        documentPages = []
        exportedDocumentPath = ""
        documentStatus = "Cleared document bundle."
    }

    func exportDocumentPDF() {
        guard !documentPages.isEmpty else {
            documentStatus = "Import at least one page before exporting."
            return
        }

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = "hanasand-document.pdf"
        guard panel.runModal() == .OK, let url = panel.url else { return }

        let pdf = PDFDocument()
        for page in documentPages {
            if let pdfPage = PDFPage(image: page.image) {
                pdf.insert(pdfPage, at: pdf.pageCount)
            }
        }

        if pdf.write(to: url) {
            exportedDocumentPath = url.path
            documentStatus = "Exported \(documentPages.count) pages to \(url.lastPathComponent)."
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            documentStatus = "Could not export PDF."
        }
    }
}
