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

struct BrowserWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel

    @Environment(\.desktopTheme) var theme

    @StateObject var workspace = BrowserWorkspaceModel(); @FocusState var addressFocused: Bool
}
