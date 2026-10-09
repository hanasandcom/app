import AppKit
import SwiftUI

struct HanasandLogo: View {
    private var resourceBundle: Bundle {
        Bundle.main.url(forResource: "Hanasand_Hanasand", withExtension: "bundle")
            .flatMap(Bundle.init(url:)) ?? .module
    }

    private var logoImage: NSImage? {
        guard let url = resourceBundle.url(forResource: "hanasand-logo", withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }

    var body: some View {
        ZStack {
            Color.black
            if let logoImage {
                Image(nsImage: logoImage)
                    .renderingMode(.original)
                    .resizable()
                    .scaledToFit()
            }
        }
        .accessibilityLabel("Hanasand logo")
    }
}
