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

struct ImageReviewWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var confirmTrash = false
    @State var isDropTargeted = false

    var discardCount: Int { model.imageReviewDecisions.values.filter { $0 == .discard }.count }
    var remaining: Int { max(model.imageReviewItems.count - model.imageReviewIndex, 0) }

    var body: some View {
        FeatureWorkspace(title: "Images", subtitle: model.imageReviewStatus) {
            HStack(spacing: 10) {
                ActionButton(title: "Import images", icon: "photo.stack") { model.importImagesForReview() }
                ActionButton(title: "Undo", icon: "arrow.uturn.backward") { model.undoImageDecision() }
                ActionButton(title: "Restart", icon: "arrow.counterclockwise") { model.restartImageReview() }
                ActionButton(title: "Trash marked (\(discardCount))", icon: "trash", tone: .danger) { confirmTrash = true }
                    .disabled(discardCount == 0)
            }
            HStack(spacing: 12) {
                FeatureCard(title: "Remaining", value: "\(remaining)", icon: "rectangle.stack")
                FeatureCard(title: "Keep", value: "\(model.imageReviewDecisions.values.filter { $0 == .keep }.count)", icon: "checkmark.circle")
                FeatureCard(title: "Discard later", value: "\(discardCount)", icon: "trash")
            }
            if let current = model.currentImageReviewItem {
                NativeGroupPanel(title: current.title, subtitle: current.sizeLabel) {
                    Image(nsImage: current.image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 520)
                        .frame(maxWidth: .infinity)
                        .background(Color.black.opacity(0.2))
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .contextMenu {
                            Button("Keep") {
                                model.decideCurrentImage(.keep)
                            }
                            Button("Discard Later") {
                                model.decideCurrentImage(.discard)
                            }
                            Button("Undo Last Decision") {
                                model.undoImageDecision()
                            }
                            Divider()
                            Button("Reveal in Finder") {
                                model.revealCurrentImage()
                            }
                            Button("Copy Path") {
                                model.copyCurrentImagePath()
                            }
                        }
                    HStack(spacing: 10) {
                        ActionButton(title: "Discard later", icon: "xmark.circle", tone: .danger) { model.decideCurrentImage(.discard) }
                        ActionButton(title: "Keep", icon: "checkmark.circle") { model.decideCurrentImage(.keep) }
                        Spacer()
                        ActionButton(title: "Reveal", icon: "folder") {
                            NSWorkspace.shared.activateFileViewerSelecting([current.url])
                        }
                    }
                }
            } else {
                NativeEmptyState(title: model.imageReviewItems.isEmpty ? (isDropTargeted ? "Drop to import" : "No images") : "Batch sorted", message: model.imageReviewItems.isEmpty ? "Drop images. Mark keep/discard; trash only when done." : "Review complete. Undo or trash marked files.")
            }
        }
        .onDrop(of: [UTType.fileURL.identifier], isTargeted: $isDropTargeted) { providers in
            model.importImageProviders(providers)
        }
        .alert("Move marked images to Trash?", isPresented: $confirmTrash) {
            Button("Move to Trash", role: .destructive) { model.trashDiscardedImages() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\(discardCount) image\(discardCount == 1 ? "" : "s") will be moved to the macOS Trash.")
        }
    }
}
