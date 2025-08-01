<?php
/**
 * Plugin Name: Clean PDF Viewer
 * Description: A clean PDF viewer with zoom, navigation, download, and fullscreen controls
 * Version: 1.0.0
 * Author: Your Name
 * Requires at least: 5.0
 * Tested up to: 6.6
 * Requires PHP: 7.4
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: clean-pdf-viewer
 * Domain Path: /languages
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

class CleanPDFViewer {
    
    public function __construct() {
        // Check WordPress version compatibility
        add_action('admin_init', array($this, 'check_wordpress_version'));
        
        add_action('init', array($this, 'init'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_scripts'));
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_shortcode('clean_pdf_viewer', array($this, 'pdf_viewer_shortcode'));
        add_action('wp_ajax_nopriv_get_pdf_data', array($this, 'get_pdf_data'));
        add_action('wp_ajax_get_pdf_data', array($this, 'get_pdf_data'));
        
        // Add plugin activation hook
        register_activation_hook(__FILE__, array($this, 'activate'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate'));
    }

    public function add_admin_menu() {
    add_options_page(
        'Clean PDF Viewer',
        'PDF Viewer',
        'manage_options',
        'clean-pdf-viewer',
        array($this, 'admin_page_content')
    );
}

public function admin_page_content() {
    if (!current_user_can('manage_options')) return;

   $pdf_url = esc_url_raw($_POST['clean_pdf_url']);

if (!empty($pdf_url)) {
    echo '<div class="updated"><p><strong>PDF selected!</strong></p>';
    echo '<p>Use this shortcode:</p>';
    echo '<code>[clean_pdf_viewer url=\'' . esc_url($pdf_url) . '\']</code></div>';
} else {
    echo '<div class="error"><p>No PDF was selected.</p></div>';
}

    ?>
    <div class="wrap">
        <h1>Upload PDF for Viewer</h1>
        <form method="post">
    <?php wp_nonce_field('clean_pdf_select'); ?>
    <input type="hidden" id="clean_pdf_url" name="clean_pdf_url" value="" />
    <button type="button" class="button" id="select-pdf-button">Select PDF from Media Library</button>
    <p id="selected-pdf-display" style="margin-top: 10px;"></p>
    <?php submit_button('Use this PDF', 'primary', 'submit_pdf'); ?>
        </form>

    </div>
    <script>
jQuery(document).ready(function($) {
    $('#select-pdf-button').on('click', function(e) {
        e.preventDefault();
        const file_frame = wp.media({
            title: 'Select a PDF',
            button: { text: 'Use this PDF' },
            library: { type: 'application/pdf' },
            multiple: false
        });

        file_frame.on('select', function() {
            const attachment = file_frame.state().get('selection').first().toJSON();
            $('#clean_pdf_url').val(attachment.url);
            $('#selected-pdf-display').html('<strong>Selected:</strong> ' + attachment.url);
        });

        file_frame.open();
    });
});
</script>

    <?php
}

    
    public function check_wordpress_version() {
        global $wp_version;
        $required_wp_version = '5.0';
        
        if (version_compare($wp_version, $required_wp_version, '<')) {
            add_action('admin_notices', array($this, 'wordpress_version_notice'));
            deactivate_plugins(plugin_basename(__FILE__));
        }
    }
    
    public function wordpress_version_notice() {
        echo '<div class="notice notice-error"><p>';
        echo esc_html__('Clean PDF Viewer requires WordPress 5.0 or higher. Please update WordPress.', 'clean-pdf-viewer');
        echo '</p></div>';
    }
    
    public function activate() {
        // Plugin activation tasks
        if (!current_user_can('activate_plugins')) {
            return;
        }
        
        // Flush rewrite rules
        flush_rewrite_rules();
    }
    
    public function deactivate() {
        // Plugin deactivation tasks
        flush_rewrite_rules();
    }
    
    public function init() {
        // Plugin initialization
    }
    
    public function enqueue_scripts() {
        // Only enqueue on pages that have the shortcode
        global $post;
        if (!is_a($post, 'WP_Post') || !has_shortcode($post->post_content, 'clean_pdf_viewer')) {
            return;
        }
        
        // Enqueue PDF.js with fallback
        wp_enqueue_script(
            'pdfjs-dist',
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
            array(),
            '3.11.174',
            true
        );
        
        // Enqueue plugin CSS
        wp_enqueue_style(
            'clean-pdf-viewer-css',
            plugin_dir_url(__FILE__) . 'css/clean-pdf-viewer.css',
            array(),
            '1.0.0'
        );
        
        // Enqueue plugin JS
        wp_enqueue_script(
            'clean-pdf-viewer-js',
            plugin_dir_url(__FILE__) . 'js/clean-pdf-viewer.js',
            array('jquery', 'pdfjs-dist'),
            '1.0.0',
            true
        );
        
        // Localize script for AJAX and translations
        wp_localize_script('clean-pdf-viewer-js', 'cleanPdfAjax', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('clean_pdf_nonce'),
            'strings' => array(
                'loading' => __('Loading PDF...', 'clean-pdf-viewer'),
                'error' => __('Error loading PDF. Please try again.', 'clean-pdf-viewer'),
                'page' => __('Page', 'clean-pdf-viewer'),
                'of' => __('of', 'clean-pdf-viewer'),
                'fullscreen' => __('Fullscreen', 'clean-pdf-viewer'),
                'exit_fullscreen' => __('Exit Fullscreen', 'clean-pdf-viewer')
            )
        ));
    }
    
    public function pdf_viewer_shortcode($atts) {
        $atts = shortcode_atts(array(
            'url' => '',
            'pdf' => '',
            'width' => '100%',
            'height' => '600px'
        ), $atts);

        // Use 'pdf' if 'url' is empty
        $atts['url'] = !empty($atts['url']) ? $atts['url'] : $atts['pdf'];

        
        if (empty($atts['url'])) {
            return '<p>' . esc_html__('Please provide a PDF URL using the url parameter.', 'clean-pdf-viewer') . '</p>';
        }
        
        // Validate URL
        if (!filter_var($atts['url'], FILTER_VALIDATE_URL)) {
            return '<p>' . esc_html__('Please provide a valid PDF URL.', 'clean-pdf-viewer') . '</p>';
        }
        
        $viewer_id = 'pdf-viewer-' . uniqid();
        
        ob_start();
        wp_enqueue_media();
        ?>
        <div class="clean-pdf-viewer-container" style="width: <?php echo esc_attr($atts['width']); ?>; height: <?php echo esc_attr($atts['height']); ?>;" data-viewer-id="<?php echo esc_attr($viewer_id); ?>">
            <div class="pdf-controls">
                <div class="pdf-controls-left">
                    <button class="pdf-btn pdf-prev" data-viewer="<?php echo esc_attr($viewer_id); ?>" aria-label="<?php esc_attr_e('Previous page', 'clean-pdf-viewer'); ?>">
                        ← <?php esc_html_e('Previous', 'clean-pdf-viewer'); ?>
                    </button>
                    <span class="pdf-page-info" role="status" aria-live="polite">
                        <?php esc_html_e('Page', 'clean-pdf-viewer'); ?> <span class="pdf-current-page">1</span> <?php esc_html_e('of', 'clean-pdf-viewer'); ?> <span class="pdf-total-pages">-</span>
                    </span>
                    <button class="pdf-btn pdf-next" data-viewer="<?php echo esc_attr($viewer_id); ?>" aria-label="<?php esc_attr_e('Next page', 'clean-pdf-viewer'); ?>">
                        <?php esc_html_e('Next', 'clean-pdf-viewer'); ?> →
                    </button>
                </div>
                <div class="pdf-controls-right">
                    <button class="pdf-btn pdf-zoom-out" data-viewer="<?php echo esc_attr($viewer_id); ?>" aria-label="<?php esc_attr_e('Zoom out', 'clean-pdf-viewer'); ?>">
                        <?php esc_html_e('Zoom Out', 'clean-pdf-viewer'); ?>
                    </button>
                    <span class="pdf-zoom-level" role="status" aria-live="polite">100%</span>
                    <button class="pdf-btn pdf-zoom-in" data-viewer="<?php echo esc_attr($viewer_id); ?>" aria-label="<?php esc_attr_e('Zoom in', 'clean-pdf-viewer'); ?>">
                        <?php esc_html_e('Zoom In', 'clean-pdf-viewer'); ?>
                    </button>
                    <button class="pdf-btn pdf-fullscreen" data-viewer="<?php echo esc_attr($viewer_id); ?>" aria-label="<?php esc_attr_e('Toggle fullscreen', 'clean-pdf-viewer'); ?>">
                        <?php esc_html_e('Fullscreen', 'clean-pdf-viewer'); ?>
                    </button>
                    <button class="pdf-btn pdf-download" data-url="<?php echo esc_attr($atts['url']); ?>" aria-label="<?php esc_attr_e('Download PDF', 'clean-pdf-viewer'); ?>">
                        <?php esc_html_e('Download', 'clean-pdf-viewer'); ?>
                    </button>
                </div>
            </div>
            <div class="pdf-viewer-wrapper">
                <canvas id="<?php echo esc_attr($viewer_id); ?>" class="pdf-canvas" data-pdf-url="<?php echo esc_attr($atts['url']); ?>" role="img" aria-label="<?php esc_attr_e('PDF document viewer', 'clean-pdf-viewer'); ?>"></canvas>
            </div>
            <div class="pdf-loading" aria-hidden="true"><?php esc_html_e('Loading PDF...', 'clean-pdf-viewer'); ?></div>
            <div class="pdf-error" style="display: none;" role="alert"><?php esc_html_e('Error loading PDF. Please try again.', 'clean-pdf-viewer'); ?></div>
        </div>
        <?php
        return ob_get_clean();
    }
    
    public function get_pdf_data() {
        // Verify nonce for security
        if (!wp_verify_nonce($_POST['nonce'], 'clean_pdf_nonce')) {
            wp_send_json_error('Invalid nonce');
            return;
        }
        
        $pdf_url = sanitize_url($_POST['pdf_url']);
        
        // Additional URL validation
        if (!filter_var($pdf_url, FILTER_VALIDATE_URL)) {
            wp_send_json_error('Invalid URL');
            return;
        }
        
        // Here you could add additional server-side PDF processing if needed
        
        wp_send_json_success(array(
            'url' => $pdf_url
        ));
    }
}new CleanPDFViewer();
