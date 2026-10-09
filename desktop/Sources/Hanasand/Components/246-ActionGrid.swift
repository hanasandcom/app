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

struct ActionGrid: View {
    let actions: [DesktopAction]

    let columns = [
        GridItem(.adaptive(minimum: 220), spacing: 12, alignment: .top),
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            ForEach(actions) { action in
                ActionCard(action: action)
            }
        }
    }
}
