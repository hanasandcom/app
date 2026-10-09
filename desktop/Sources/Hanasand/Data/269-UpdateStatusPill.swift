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

struct UpdateStatusPill: View {
    @Environment(\.desktopTheme) var theme
    let status: AppUpdateStatus

    var body: some View {
        HStack(spacing: 7) {
            ZStack {
                if status.isBusy {
                    ProgressView()
                        .scaleEffect(0.45)
                } else if status.isServerUnavailable {
                    Image(systemName: "wifi.slash")
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(theme.danger)
                } else {
                    Circle()
                        .fill(color)
                        .frame(width: 7, height: 7)
                }
            }
            .frame(width: 13, height: 13)
            Text(status.title)
                .lineLimit(1)
                .minimumScaleFactor(0.78)
        }
        .font(.system(size: 11, weight: .bold))
        .frame(width: 108, height: 28)
        .background(theme.cardRaised)
        .overlay(Capsule().stroke(theme.divider, lineWidth: 1))
        .clipShape(Capsule())
    }

    var color: Color {
        switch status {
        case .ready:
            return theme.accent
        case .unavailable:
            return theme.accent
        case .failed:
            return theme.danger
        default:
            return theme.green
        }
    }
}
