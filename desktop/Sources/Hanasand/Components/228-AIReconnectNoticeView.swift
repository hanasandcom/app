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

struct AIReconnectNoticeView: View {
    @Environment(\.desktopTheme) var theme
    let message: AIChatMessage

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            VStack(spacing: 14) {
                if message.isPending {
                    TimelineView(.periodic(from: message.reconnectStartedAt ?? message.createdAt, by: 1)) { timeline in
                        VStack(spacing: 12) {
                            Text("Reconnecting")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(theme.text)
                            Text("The AI service is taking a moment. I’ll keep trying in the background.")
                                .font(.system(size: 13, weight: .regular))
                                .foregroundStyle(theme.textSecondary)
                                .multilineTextAlignment(.center)
                            ReconnectSweepBar(startedAt: message.reconnectStartedAt ?? message.createdAt, now: timeline.date)
                                .frame(width: 230, height: 3)
                            Text(elapsedText(now: timeline.date))
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(theme.textTertiary)
                        }
                    }
                } else {
                    Text(message.content)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(message.isError ? theme.danger : theme.text)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 22)
            .frame(maxWidth: 460)
            .background(theme.card.opacity(0.46))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(theme.divider.opacity(0.6), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: message.isPending ? 300 : 140, alignment: .center)
    }

    func elapsedText(now: Date) -> String {
        let startedAt = message.reconnectStartedAt ?? message.createdAt
        return "Trying again for \(Self.durationText(now.timeIntervalSince(startedAt)))"
    }

    static func durationText(_ interval: TimeInterval) -> String {
        let seconds = max(1, Int(interval.rounded()))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        return "\(hours)h"
    }
}
