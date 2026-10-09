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

struct DesktopTheme {
    let isLight: Bool
    let background: Color
    let backgroundElevated: Color
    let sidebar: Color
    let sidebarSelected: Color
    let commandPanel: Color
    let commandBar: Color
    let card: Color
    let cardRaised: Color
    let field: Color
    let divider: Color
    let text: Color
    let textSecondary: Color
    let textTertiary: Color
    let accent: Color
    let accentSoft: Color
    let green: Color
    let danger: Color

    init(preference: AppearancePreference, systemScheme: ColorScheme) {
        isLight = preference == .light || (preference == .system && systemScheme == .light)
        if isLight {
            background = Color(red: 0.961, green: 0.961, blue: 0.961)
            backgroundElevated = .white
            sidebar = background
            sidebarSelected = Color(red: 0.188, green: 0.337, blue: 0.827).opacity(0.09)
            commandPanel = .white
            commandBar = Color(red: 0.929, green: 0.929, blue: 0.929)
            card = Color(red: 0.929, green: 0.929, blue: 0.929)
            cardRaised = .white
            field = .white
            divider = Color(red: 0.831, green: 0.831, blue: 0.831)
            text = Color(red: 0.090, green: 0.102, blue: 0.129)
            textSecondary = Color(red: 0.302, green: 0.302, blue: 0.302)
            textTertiary = Color(red: 0.420, green: 0.420, blue: 0.420)
            accent = Color(red: 0.188, green: 0.337, blue: 0.827)
            accentSoft = accent.opacity(0.11)
            green = Color(red: 0.078, green: 0.478, blue: 0.231)
            danger = Color(red: 0.706, green: 0.137, blue: 0.094)
        } else {
            background = Color(red: 0.027, green: 0.027, blue: 0.027)
            backgroundElevated = Color(red: 0.063, green: 0.063, blue: 0.063)
            sidebar = background
            sidebarSelected = Color(red: 0.561, green: 0.698, blue: 1).opacity(0.12)
            commandPanel = backgroundElevated
            commandBar = backgroundElevated
            card = Color(red: 0.063, green: 0.063, blue: 0.063)
            cardRaised = Color(red: 0.098, green: 0.098, blue: 0.098)
            field = Color(red: 0.063, green: 0.063, blue: 0.063)
            divider = Color.white.opacity(0.12)
            text = Color(red: 0.961, green: 0.969, blue: 0.984)
            textSecondary = Color(red: 0.600, green: 0.600, blue: 0.600)
            textTertiary = Color(red: 0.600, green: 0.600, blue: 0.600).opacity(0.72)
            accent = Color(red: 0.561, green: 0.698, blue: 1)
            accentSoft = accent.opacity(0.14)
            green = Color(red: 0.490, green: 0.878, blue: 0.635)
            danger = Color(red: 1, green: 0.722, blue: 0.690)
        }
    }
}
