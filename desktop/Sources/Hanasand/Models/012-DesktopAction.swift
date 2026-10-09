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

struct DesktopAction: Identifiable {
    enum Kind {
        case route(String)
        case url(String)
        case task
    }

    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let kind: Kind
    let task: ((DesktopAgentModel) -> Void)?

    static func route(_ title: String, _ subtitle: String, _ icon: String, _ path: String) -> DesktopAction {
        DesktopAction(title: title, subtitle: subtitle, icon: icon, kind: .route(path), task: nil)
    }

    static func url(_ title: String, _ subtitle: String, _ icon: String, _ url: String) -> DesktopAction {
        DesktopAction(title: title, subtitle: subtitle, icon: icon, kind: .url(url), task: nil)
    }

    static func task(_ title: String, _ subtitle: String, _ icon: String, action: @escaping (DesktopAgentModel) -> Void) -> DesktopAction {
        DesktopAction(title: title, subtitle: subtitle, icon: icon, kind: .task, task: action)
    }

    @MainActor
    func perform(with model: DesktopAgentModel) {
        switch kind {
        case .route(let path):
            model.openNativeDashboard(path: path, label: title)
        case .url(let url):
            model.openURL(url, label: title)
        case .task:
            task?(model)
        }
    }

    var trailingIcon: String {
        switch kind {
        case .route:
            return "arrow.right"
        case .url:
            return "arrow.up.forward"
        case .task:
            return "bolt.fill"
        }
    }

}
