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

struct AIModelsNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    let columns = [
        GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                FeatureCard(title: "Clients", value: "\(model.aiClients.count)", icon: "cpu")
                FeatureCard(title: "Ready", value: "\(model.aiClients.filter { ($0.model?.status ?? "").localizedCaseInsensitiveContains("ready") }.count)", icon: "checkmark.circle")
                FeatureCard(title: "Fastest", value: model.aiClients.sortedForRuntime.first?.name ?? "None", icon: "speedometer")
            }

            HStack(spacing: 10) {
                ActionButton(title: "Refresh models", icon: "arrow.clockwise") {
                    Task { await model.loadNativeDashboardData() }
                }
                ActionButton(title: "Open Chat", icon: "sparkles") {
                    model.selectedSection = .command
                    Task { await model.loadAIPage() }
                }
            }

            if model.aiClients.isEmpty {
                NativeEmptyState(title: "No AI clients loaded", message: "Use Refresh models to load connected model clients, or open AI chat to reconnect the runtime.")
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(model.aiClients.sortedForRuntime) { client in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 10) {
                                Image(systemName: "cpu")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(theme.accent)
                                    .frame(width: 38, height: 38)
                                    .background(theme.accentSoft)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(client.name)
                                        .font(.system(size: 14, weight: .black))
                                        .foregroundStyle(theme.text)
                                        .lineLimit(1)
                                    Text(client.statusText)
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(theme.textTertiary)
                                        .lineLimit(1)
                                }
                            }

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                                MiniMetricCard(label: "TPS", value: String(format: "%.1f", client.model?.tps ?? 0))
                                MiniMetricCard(label: "Generated", value: "\(client.model?.generatedTokens ?? 0)")
                                MiniMetricCard(label: "Context", value: "\(client.model?.contextTokens ?? 0)")
                                MiniMetricCard(label: "Max", value: "\(client.model?.contextMaxTokens ?? 0)")
                            }

                            if let error = client.model?.lastError, !error.isEmpty {
                                NativeNotice(message: error, title: "Last model error")
                            }
                        }
                        .padding(13)
                        .background(theme.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(theme.divider, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
            }
        }
    }
}
