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

struct DocumentWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var confirmClear = false
    @State var isDropTargeted = false

    var body: some View {
        FeatureWorkspace(title: "Documents", subtitle: model.documentStatus) {
            HStack(spacing: 10) {
                ActionButton(title: "Import pages", icon: "square.and.arrow.down") { model.importDocumentPages() }
                ActionButton(title: "Export PDF", icon: "doc.richtext") { model.exportDocumentPDF() }
                ActionButton(title: "Clear", icon: "trash", tone: .danger) { confirmClear = true }
                    .disabled(model.documentPages.isEmpty)
            }
            HStack(spacing: 12) {
                FeatureCard(title: "Pages", value: "\(model.documentPages.count)", icon: "doc.on.doc")
                FeatureCard(title: "Mode", value: "Import/reorder/export", icon: "arrow.up.arrow.down")
                FeatureCard(title: "Last export", value: model.exportedDocumentPath.isEmpty ? "None" : URL(fileURLWithPath: model.exportedDocumentPath).lastPathComponent, icon: "checkmark.seal")
            }
            if model.documentPages.isEmpty {
                NativeEmptyState(title: isDropTargeted ? "Drop to import" : "No pages", message: "Drop PDFs/images. Reorder, delete, export.")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], alignment: .leading, spacing: 12) {
                    ForEach(Array(model.documentPages.enumerated()), id: \.element.id) { index, page in
                        VStack(alignment: .leading, spacing: 10) {
                            Image(nsImage: page.image)
                                .resizable()
                                .scaledToFit()
                                .frame(height: 220)
                                .frame(maxWidth: .infinity)
                                .background(Color.black.opacity(0.18))
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            HStack {
                                Text("Page \(index + 1)")
                                    .font(.system(size: 12, weight: .black))
                                Spacer()
                                Text(page.title)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(theme.textTertiary)
                                    .lineLimit(1)
                            }
                            HStack(spacing: 8) {
                                Button("Up") { model.moveDocumentPage(page, direction: -1) }
                                    .disabled(index == 0)
                                Button("Down") { model.moveDocumentPage(page, direction: 1) }
                                    .disabled(index == model.documentPages.count - 1)
                                Button("Rotate") { model.rotateDocumentPage(page) }
                                Spacer()
                                Button("Delete") { model.removeDocumentPage(page) }
                                    .foregroundStyle(theme.danger)
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: .bold))
                        }
                        .padding(12)
                        .background(theme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .contextMenu {
                            Button("Reveal Source") {
                                model.revealDocumentPageSource(page)
                            }
                            .disabled(page.sourceURL == nil)
                            Button("Copy Title") {
                                model.copyDocumentPageTitle(page)
                            }
                            Divider()
                            Button("Move Up") {
                                model.moveDocumentPage(page, direction: -1)
                            }
                            .disabled(index == 0)
                            Button("Move Down") {
                                model.moveDocumentPage(page, direction: 1)
                            }
                            .disabled(index == model.documentPages.count - 1)
                            Button("Rotate") {
                                model.rotateDocumentPage(page)
                            }
                            Divider()
                            Button("Delete", role: .destructive) {
                                model.removeDocumentPage(page)
                            }
                        }
                    }
                }
            }
        }
        .onDrop(of: [UTType.fileURL.identifier], isTargeted: $isDropTargeted) { providers in
            model.importDocumentProviders(providers)
        }
        .alert("Clear document bundle?", isPresented: $confirmClear) {
            Button("Clear", role: .destructive) { model.clearDocumentPages() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes \(model.documentPages.count) imported page\(model.documentPages.count == 1 ? "" : "s") from the local bundle. Original files are not deleted.")
        }
    }
}
