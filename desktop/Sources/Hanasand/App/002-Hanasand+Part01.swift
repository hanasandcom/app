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

extension Hanasand {
    var body: some Scene {
        WindowGroup {
            DesktopShell()
                .environmentObject(model)
                .frame(minWidth: 1080, minHeight: 720)
                .task { await model.start() }
        }
        .windowStyle(.hiddenTitleBar)
        .commands { appCommands }
    }
}
