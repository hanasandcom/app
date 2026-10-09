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

struct LinksNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                FeatureCard(title: "Route", value: "/g", icon: "link")
                FeatureCard(title: "CDN", value: model.settings.cdnBaseURL, icon: "network")
                FeatureCard(title: "Loaded", value: model.linkLookupResult?.id ?? "None", icon: "doc.text.magnifyingglass")
            }

            NativeGroupPanel(title: "Create shortcut", subtitle: "Create a public hanasand.com/g/:id redirect.") {
                HStack(spacing: 10) {
                    linkField("Shortcut id", text: $model.linkDraftID)
                        .frame(maxWidth: 220)
                    linkField("Destination URL or path", text: $model.linkDraftPath)
                    ActionButton(title: "Create", icon: "plus.circle") {
                        Task { await model.createShortcutLink() }
                    }
                }
            }

            NativeGroupPanel(title: "Lookup and update", subtitle: "Inspect link stats or change the destination.") {
                HStack(spacing: 10) {
                    linkField("Shortcut id", text: $model.linkLookupID)
                        .frame(maxWidth: 220)
                    ActionButton(title: "Lookup", icon: "magnifyingglass") {
                        Task { await model.lookupShortcutLink() }
                    }
                    ActionButton(title: "Update", icon: "square.and.pencil") {
                        Task { await model.updateShortcutLink() }
                    }
                }

                if let link = model.linkLookupResult {
                    linkResultCard(link)
                } else {
                    NativeNotice(
                        message: "Enter a shortcut id and run Lookup to inspect the destination, visits, and public URL.",
                        title: "Ready to inspect",
                        tone: .info
                    )
                }
            }
        }
    }

    func linkField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.text)
            .padding(11)
            .background(theme.field)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    func linkResultCard(_ link: DashboardShortcutLink) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                FeatureCard(title: "Shortcut", value: "/g/\(link.id)", icon: "link")
                FeatureCard(title: "Visits", value: "\(link.visits ?? 0)", icon: "eye")
                FeatureCard(title: "Created", value: link.timestampLabel, icon: "clock")
            }

            Text(link.path)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .lineLimit(3)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.backgroundElevated.opacity(0.72))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            HStack(spacing: 10) {
                ActionButton(title: "Copy public link", icon: "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("\(model.settings.websiteBaseURL.normalizedBaseURL.appendingPathComponent("g").appendingPathComponent(link.id))", forType: .string)
                }
                ActionButton(title: "Open shortcut", icon: "arrow.up.right") {
                    model.openWebsite(path: "/g/\(link.id)", label: link.id)
                }
                ActionButton(title: "Open destination", icon: "safari") {
                    if let url = URL(string: link.path), url.scheme != nil {
                        NSWorkspace.shared.open(url)
                    }
                }
                Spacer()
            }
        }
    }
}
