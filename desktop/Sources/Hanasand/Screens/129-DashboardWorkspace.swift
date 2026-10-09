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

struct DashboardWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        if model.selectedDashboardPath == nil {
            FeatureWorkspace(title: "Dashboard", subtitle: "") {
                DashboardSectionHeader(title: "Workspace", subtitle: "")
                ActionGrid(actions: model.dashboardActions)
                DashboardSectionHeader(title: "Administration", subtitle: "")
                ActionGrid(actions: model.adminActions)
                DashboardSectionHeader(title: "Shortcuts", subtitle: "")
                ActionGrid(actions: model.quickAppActions)
            }
        } else {
            NativeDashboardDetail()
        }
    }
}
