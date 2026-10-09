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

struct NativeRouteFallbackPanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    var body: some View {
        NativeGroupPanel(title: model.selectedDashboardTitle, subtitle: "") {
            ActionButton(title: "Open in Workspace", icon: "globe") {
                let path = model.selectedDashboardPath ?? "/dashboard"
                model.openInlineBrowser(url: path, title: model.selectedDashboardTitle, source: "Dashboard")
            }
        }
    }
}
