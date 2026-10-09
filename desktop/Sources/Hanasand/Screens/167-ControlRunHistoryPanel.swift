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

struct ControlRunHistoryPanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        NativeGroupPanel(title: "Run history", subtitle: "") {
            if model.runHistory.isEmpty {
                NativeEmptyState(title: "No runs yet", message: "Run a prompt or press an action button.")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("\(model.runHistory.count) saved")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        Button("Clear") {
                            model.clearControlRunHistory()
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(theme.danger)
                    }
                    ForEach(model.runHistory.prefix(8)) { run in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: run.kind.icon)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(run.kind == .error ? theme.danger : theme.accent)
                                .frame(width: 28, height: 28)
                                .background(run.kind == .error ? theme.danger.opacity(0.12) : theme.accentSoft)
                                .clipShape(Circle())
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(run.title)
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(theme.text)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(DateFormatter.localizedString(from: run.date, dateStyle: .none, timeStyle: .short))
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(theme.textTertiary)
                                }
                                Text(run.detail)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(theme.textSecondary)
                                    .lineLimit(2)
                                    .textSelection(.enabled)
                                HStack(spacing: 12) {
                                    Button("Reuse") {
                                        model.reuseControlRun(run)
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(theme.accent)

                                    Button("Copy") {
                                        NSPasteboard.general.clearContents()
                                        NSPasteboard.general.setString(run.detail, forType: .string)
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(theme.textTertiary)
                                }
                            }
                        }
                        .padding(10)
                        .background(theme.cardRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
        }
    }
}
