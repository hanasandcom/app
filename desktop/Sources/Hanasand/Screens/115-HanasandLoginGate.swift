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

struct HanasandLoginGate: View {
    @EnvironmentObject var model: DesktopAgentModel

    @Environment(\.desktopTheme) var theme

    @FocusState var focusedField: Field?
}
