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

struct UploadNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var isDropTargeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ActionButton(title: "Choose file", icon: "doc.badge.plus") {
                    model.chooseUploadFile()
                }
                ActionButton(title: "Check path", icon: "checkmark.seal") {
                    Task { await model.checkUploadPath() }
                }
                .disabled(model.uploadPath.isEmpty || model.isCheckingUploadPath)
                ActionButton(title: model.isUploadingFile ? "Uploading" : "Upload", icon: "arrow.up.doc") {
                    Task { await model.uploadSelectedFile() }
                }
                .disabled(model.uploadFileURL == nil || model.isUploadingFile)
                ActionButton(title: "Reset", icon: "arrow.counterclockwise") {
                    model.resetUploadDraft()
                }
                if model.isUploadingFile || model.isCheckingUploadPath {
                    ProgressView()
                        .scaleEffect(0.75)
                }
            }

            HStack(spacing: 12) {
                FeatureCard(title: "File", value: model.uploadFileURL?.lastPathComponent ?? "None", icon: "doc")
                FeatureCard(title: "Type", value: model.uploadType, icon: "tag")
                FeatureCard(title: "Path", value: uploadPathStatus, icon: "point.topleft.down.curvedto.point.bottomright.up")
            }

            NativeGroupPanel(title: isDropTargeted ? "Drop file to upload" : "CDN upload", subtitle: "Native /files upload contract") {
                VStack(alignment: .leading, spacing: 10) {
                    field("Name", text: $model.uploadName, placeholder: "Filename shown on the CDN")
                    field("Path", text: $model.uploadPath, placeholder: "optional-short-path")
                        .onChange(of: model.uploadPath) { _, _ in
                            model.uploadPathAvailable = nil
                        }
                    field("MIME type", text: $model.uploadType, placeholder: "image/png")
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Description")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                        TextEditor(text: $model.uploadDescription)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.text)
                            .scrollContentBackground(.hidden)
                            .frame(minHeight: 74)
                            .padding(8)
                            .background(theme.field)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }

                    Text(model.uploadStatus)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(statusColor)

                    if !model.uploadedFileURL.isEmpty {
                        HStack(spacing: 10) {
                            Text(model.uploadedFileURL)
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundStyle(theme.textSecondary)
                                .textSelection(.enabled)
                                .lineLimit(1)
                            Spacer()
                            ActionButton(title: "Open", icon: "arrow.up.right.square") {
                                model.openUploadedFileURL()
                            }
                            ActionButton(title: "Copy URL", icon: "doc.on.doc") {
                                model.copyUploadedFileURL()
                            }
                        }
                        .padding(10)
                        .background(Color.black.opacity(0.14))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
            .onDrop(of: [UTType.fileURL.identifier], isTargeted: $isDropTargeted) { providers in
                model.selectUploadProviders(providers)
            }
        }
    }

    var uploadPathStatus: String {
        if model.uploadPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Generated"
        }
        if model.uploadPathAvailable == true {
            return "Available"
        }
        if model.uploadPathAvailable == false {
            return "Taken"
        }
        return "Unchecked"
    }

    var statusColor: Color {
        if model.uploadStatus.localizedCaseInsensitiveContains("failed") || model.uploadStatus.localizedCaseInsensitiveContains("taken") {
            return theme.danger
        }
        if model.uploadStatus.localizedCaseInsensitiveContains("uploaded") || model.uploadStatus.localizedCaseInsensitiveContains("available") {
            return theme.green
        }
        return theme.textSecondary
    }

    func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .black))
                .foregroundStyle(theme.textTertiary)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.text)
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(theme.field)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}
