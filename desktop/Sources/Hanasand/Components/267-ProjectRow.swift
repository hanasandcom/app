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

struct ProjectRow: View {
    @Environment(\.desktopTheme) var theme
    @FocusState private var isFocused: Bool
    let project: ProjectItem
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if project.state == .folder {
                    Image(systemName: "folder")
                        .foregroundStyle(theme.textSecondary)
                        .frame(width: 18)
                } else {
                    Color.clear.frame(width: 18, height: 1)
                }
                Text(project.title)
                    .lineLimit(1)
                    .font(.system(size: 13, weight: isSelected ? .medium : .regular))
                Spacer(minLength: 8)
                if project.state == .syncing {
                    ProgressView().scaleEffect(0.45)
                }
                if project.state == .live {
                    Circle().fill(theme.green).frame(width: 7, height: 7)
                }
                if let age = project.age {
                    Text(age).foregroundStyle(theme.textTertiary)
                }
            }
            .foregroundStyle(isSelected ? theme.text : theme.textSecondary)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .background(isSelected ? theme.sidebarSelected : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(theme.accent.opacity(isFocused ? 0.8 : 0), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
