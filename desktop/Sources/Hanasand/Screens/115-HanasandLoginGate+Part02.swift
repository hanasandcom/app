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

    var recoveryCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Account recovery")
                        .font(.system(size: 17, weight: .semibold, design: .serif))
                        .foregroundStyle(theme.text)
                    Text(recoveryDetail)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                }
                Spacer()
                Button {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.9)) {
                        model.cancelPasswordReset()
                        focusedField = .username
                    }
                } label: {
                    Text("Never mind")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                }
                .buttonStyle(.plain)
            }

            if model.passwordResetStep == .code {
                HStack(spacing: 8) {
                    authTextField("Username", text: $model.passwordResetUsername, field: .resetUsername) {
                        Task { await model.requestPasswordResetCode() }
                        focusedField = .resetCode
                    }

                    secondaryButton(
                        title: model.isResettingPassword ? "Sending" : "Send code",
                        busy: model.isResettingPassword,
                        action: {
                            Task {
                                await model.requestPasswordResetCode()
                                focusedField = .resetCode
                            }
                        }
                    )
                    .disabled(model.isResettingPassword)
                }

                PasswordResetCodeBoxes(
                    code: Binding(
                        get: { model.passwordResetCode },
                        set: { model.updatePasswordResetCode($0) }
                    ),
                    isBusy: model.isResettingPassword
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
            }

            if model.passwordResetStep == .newPassword {
                authSecureField("New password", text: $model.passwordResetNewPassword, field: .resetPassword) {
                    focusedField = .resetConfirm
                }

                authSecureField("Confirm new password", text: $model.passwordResetConfirmPassword, field: .resetConfirm) {
                    Task { await model.completePasswordReset() }
                }

                primaryButton(
                    title: model.isResettingPassword ? "Setting" : "Set password",
                    busy: model.isResettingPassword,
                    action: { Task { await model.completePasswordReset() } }
                )
                .disabled(model.isResettingPassword)
            }

            if !model.passwordResetStatus.isEmpty {
                statusText(model.passwordResetStatus, isSuccess: recoveryStatusLooksHelpful)
            }
        }
        .padding(14)
        .background(theme.backgroundElevated.opacity(theme.isLight ? 0.92 : 0.62))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(theme.accent.opacity(0.32), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(theme.isLight ? 0.08 : 0.20), radius: 20, x: 0, y: 12)
    }

    var recoveryDetail: String {
        model.passwordResetStep == .newPassword
            ? "Choose a new password after confirming your code."
            : "We will send a one-time code to continue."
    }

    var recoveryStatusLooksHelpful: Bool {
        let status = model.passwordResetStatus.lowercased()
        return status.contains("check") || status.contains("accepted")
    }

    func authTextField(
        _ placeholder: String,
        text: Binding<String>,
        field: Field,
        onSubmit: @escaping () -> Void
    ) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(theme.text)
            .focused($focusedField, equals: field)
            .onSubmit(onSubmit)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(theme.field)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(focusedField == field ? theme.accent.opacity(0.75) : theme.divider, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    func authSecureField(
        _ placeholder: String,
        text: Binding<String>,
        field: Field,
        onSubmit: @escaping () -> Void
    ) -> some View {
        SecureField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(theme.text)
            .focused($focusedField, equals: field)
            .onSubmit(onSubmit)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(theme.field)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(focusedField == field ? theme.accent.opacity(0.75) : theme.divider, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    func primaryButton(title: String, busy: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy {
                    ProgressView()
                        .scaleEffect(0.54)
                        .frame(width: 12, height: 12)
                }
                Text(title)
            }
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(theme.background)
            .padding(.horizontal, 18)
            .frame(minWidth: busy ? 118 : 96)
            .frame(height: 36)
            .background(theme.text)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
