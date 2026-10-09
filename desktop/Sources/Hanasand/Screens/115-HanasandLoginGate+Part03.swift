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

    func secondaryButton(title: String, busy: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy {
                    ProgressView()
                        .scaleEffect(0.54)
                        .frame(width: 12, height: 12)
                }
                Text(title)
            }
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(theme.text)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(theme.cardRaised)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(theme.divider, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    func statusText(_ value: String, isSuccess: Bool) -> some View {
        Text(value)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(isSuccess ? theme.green : theme.danger)
    }
}
