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

struct MailWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel

    var body: some View {
        FeatureWorkspace(title: "Mail", subtitle: model.mailOverview == nil ? "Inbox and accounts" : model.mailSummary) {
            MailNativePanel()
        }
    }
}
