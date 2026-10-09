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

struct BrowserTabButton: View {
    @Environment(\.desktopTheme) var theme
    @ObservedObject var tab: BrowserTabState
    let selected: Bool
    let select: () -> Void
    let close: () -> Void
    let moveTargets: () -> [BrowserTabGroup]
    let move: (String) -> Void

    var body: some View {
        Button(action: select) {
            HStack(spacing: 8) {
                Image(systemName: tab.isLoading ? "circle.dotted" : "macwindow")
                    .font(.system(size: 11, weight: .bold))
                Text(tab.label)
                    .lineLimit(1)
                    .frame(maxWidth: 140, alignment: .leading)
                if !moveTargets().isEmpty {
                    Menu {
                        ForEach(moveTargets()) { group in
                            Button(group.title) {
                                move(group.id)
                            }
                        }
                    } label: {
                        Image(systemName: "folder.badge.plus")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(theme.textTertiary)
                    }
                    .menuStyle(.borderlessButton)
                    .frame(width: 18)
                    .help("Move tab to group")
                }
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(theme.textTertiary)
                }
                .buttonStyle(.plain)
            }
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(selected ? theme.text : theme.textSecondary)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(selected ? theme.commandBar : theme.card.opacity(0.72))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
