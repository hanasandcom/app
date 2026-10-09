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

extension HanasandLoginGate {

    enum Field {
        case username
        case password
        case resetUsername
        case resetCode
        case resetPassword
        case resetConfirm
    }

    var body: some View {
        ZStack {
            theme.background
            VStack(alignment: .leading, spacing: 16) {
                masthead
                if model.pendingDeletionUserID.isEmpty {
                    loginCard
                    if model.passwordResetStep != .idle {
                        recoveryCard
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                } else {
                    pendingDeletionCard
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .frame(width: 392, alignment: .leading)
        }
        .onAppear {
            focusedField = .username
        }
    }

    var masthead: some View {
        VStack(spacing: 9) {
            Text("Hanasand")
                .font(.system(size: 46, weight: .semibold, design: .serif))
                .kerning(0.5)
                .foregroundStyle(theme.text)
            Rectangle()
                .fill(theme.text.opacity(0.22))
                .frame(width: 44, height: 1)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.bottom, 14)
    }

    var loginCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            VStack(alignment: .leading, spacing: 7) {
                authTextField("Username", text: $model.loginUsername, field: .username) {
                    focusedField = .password
                }
                authSecureField("Password", text: $model.loginPassword, field: .password) {
                    Task { await model.loginToHanasand() }
                }
            }

            HStack(alignment: .center, spacing: 12) {
                primaryButton(
                    title: model.isLoggingIn ? "Logging in" : "Log in",
                    busy: model.isLoggingIn,
                    action: { Task { await model.loginToHanasand() } }
                )
                .disabled(model.isLoggingIn)

                Spacer(minLength: 12)

                if model.passwordResetStep == .idle {
                    Button {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                            model.beginPasswordReset()
                            focusedField = .resetUsername
                        }
                    } label: {
                        Text("Forgot password?")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                    }
                    .buttonStyle(.plain)
                }
            }

            if !model.loginStatus.isEmpty {
                statusText(model.loginStatus, isSuccess: false)
            }
        }
        .padding(14)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(theme.isLight ? 0.08 : 0.24), radius: 22, x: 0, y: 14)
    }

    var pendingDeletionCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Account pending deletion")
                    .font(.system(size: 17, weight: .semibold, design: .serif))
                    .foregroundStyle(theme.text)
                Text("@\(model.pendingDeletionUserID) is scheduled to be permanently deleted on \(pendingDeletionDateText).")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Button {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.9)) {
                        model.clearPendingDeletionState()
                    }
                } label: {
                    Text("Go back")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                        .frame(height: 36)
                        .padding(.horizontal, 8)
                }
                .buttonStyle(.plain)

                Spacer()

                primaryButton(
                    title: model.isRestoringPendingDeletion ? "Restoring" : "Restore",
                    busy: model.isRestoringPendingDeletion,
                    action: { Task { await model.restorePendingDeletionAccount() } }
                )
                .disabled(model.isRestoringPendingDeletion)
            }
            if !model.pendingDeletionStatus.isEmpty {
                statusText(model.pendingDeletionStatus, isSuccess: model.pendingDeletionStatus.lowercased().contains("restored"))
            }
        }
        .padding(14)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(theme.isLight ? 0.08 : 0.24), radius: 22, x: 0, y: 14)
    }

    var pendingDeletionDateText: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallbackFormatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: model.pendingDeletionScheduledAt) ?? fallbackFormatter.date(from: model.pendingDeletionScheduledAt) else {
            return "the scheduled deletion time"
        }
        return date.formatted(date: .complete, time: .shortened)
    }
}
