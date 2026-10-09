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

struct IDEWorkspace: View {
    @EnvironmentObject var appModel: DesktopAgentModel

    @Environment(\.desktopTheme) var theme

    @StateObject var model = IDEWorkspaceModel(); @State var terminalAutoScroll = true; @State var toolsExpanded = false
}
