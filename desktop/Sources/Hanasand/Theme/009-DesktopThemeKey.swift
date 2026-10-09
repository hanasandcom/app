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

struct DesktopThemeKey: EnvironmentKey {
    static let defaultValue = DesktopTheme(preference: .dark, systemScheme: .dark)
}
