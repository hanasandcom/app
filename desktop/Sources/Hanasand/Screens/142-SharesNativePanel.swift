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

struct SharesNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    @Environment(\.desktopTheme) var theme

    @State var deletingShare: DashboardShare?
}
