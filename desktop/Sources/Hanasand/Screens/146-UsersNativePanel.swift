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

struct UsersNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    @Environment(\.desktopTheme) var theme

    @State var searchText = ""; @State var pendingStatusUser: DashboardUser?; @State var pendingDeleteUser: DashboardUser?; @State var pendingImpersonationUser: DashboardUser?
    @State var impersonationReason = ""; @State var impersonationReasonError = ""
}
