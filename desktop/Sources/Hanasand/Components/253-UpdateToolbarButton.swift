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

struct UpdateToolbarButton: View {
    let title: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(tint)
                .padding(.horizontal, 8)
                .frame(height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
