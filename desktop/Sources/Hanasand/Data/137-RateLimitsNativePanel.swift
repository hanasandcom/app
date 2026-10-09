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

struct RateLimitsNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    @Environment(\.desktopTheme) var theme

    @State var searchText = ""; @State var deletingApiKey: DashboardApiKeySummary?
    @State var ownerPickerFocused = false
}
