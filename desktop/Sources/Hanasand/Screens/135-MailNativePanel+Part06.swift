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

extension MailNativePanel {

    func filtersPanel(_ overview: MailOverviewEnvelope) -> some View {
        NativeGroupPanel(title: "Rules", subtitle: "\(overview.filters?.count ?? 0) filters") {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Rule name", text: $model.mailFilterName)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .padding(10)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                TextField("Sender contains", text: $model.mailFilterContains)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .padding(10)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                TextField("Move to mailbox", text: $model.mailFilterTargetMailbox)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .padding(10)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                ActionButton(title: "Add rule", icon: "line.3.horizontal.decrease.circle") {
                    Task { await model.createMailFilter() }
                }
            }

            ForEach((overview.filters ?? []).prefix(4)) { filter in
                HStack(spacing: 8) {
                    Image(systemName: filter.enabled == false ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                        .foregroundStyle(filter.enabled == false ? theme.textTertiary : theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(filter.name)
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.text)
                        Text(filter.ruleLabel)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(2)
                    }
                    Spacer()
                    Button("Delete") {
                        Task { await model.deleteMailFilter(filter) }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(theme.danger)
                }
                .padding(9)
                .background(theme.cardRaised)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
        }
    }

    var filteredMessages: [MailOverviewEnvelope.Message] {
        guard let messages = overview?.messages else { return [] }
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return messages }
        return messages.filter { message in
            [
                message.subjectLabel,
                message.fromLabel,
                message.preview ?? "",
                message.bodyText,
            ].joined(separator: " ").lowercased().contains(query)
        }
    }
}
