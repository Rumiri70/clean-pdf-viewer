<?php
/**
 * Plugin Name: Clean PDF Viewer
 * Description: A clean PDF viewer with zoom, navigation, download, and fullscreen controls
 * Version: 2.0.2
 * Author: Rumiri
 * Requires at least: 5.0
 * Tested up to: 6.6
 * Requires PHP: 7.4
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: clean-pdf-viewer
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

class CleanPDFViewer {
    
    private $table_name;
    
    public function __construct() {
        global $wpdb;
        $this->table_name = $wpdb->prefix . 'clean_pdf_books';
        
        // Initialize hooks
        $this->init_hooks();
    }
    
    private function init_hooks() {
        // Admin hooks
        add_action('admin_init', array($this, 'check_wordpress_version'));
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_enqueue_scripts', array($this, 'admin_enqueue_scripts'));
        
        // Frontend hooks
        add_action('init', array($this, 'init'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_scripts'));
        
        // Shortcodes
        add_shortcode('clean_pdf_viewer', array($this, 'pdf_viewer_shortcode'));
        add_shortcode('pdf_book_selector', array($this, 'book_selector_shortcode'));
        
        // AJAX hooks
        add_action('wp_ajax_toggle_book_status', array($this, 'toggle_book_status'));
        add_action('wp_ajax_delete_book', array($this, 'delete_book'));
        add_action('wp_ajax_load_pdf_viewer', array($this, 'load_pdf_viewer'));
        add_action('wp_ajax_nopriv_load_pdf_viewer', array($this, 'load_pdf_viewer'));
        add_action('wp_ajax_serve_protected_pdf', array($this, 'serve_protected_pdf'));
        add_action('wp_ajax_nopriv_serve_protected_pdf', array($this, 'serve_protected_pdf'));
        
        // Plugin hooks
        register_activation_hook(__FILE__, array($this, 'activate'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate'));
    }

    public function add_admin_menu() {
        add_menu_page(
            'PDF Books Manager',
            'PDF Books',
            'manage_options',
            'clean-pdf-viewer',
            array($this, 'admin_page_content'),
            'dashicons-book-alt',
            30
        );
        
        add_submenu_page(
            'clean-pdf-viewer',
            'All Books',
            'All Books',
            'manage_options',
            'clean-pdf-viewer',
            array($this, 'admin_page_content')
        );
        
        add_submenu_page(
            'clean-pdf-viewer',
            'Add New Book',
            'Add New Book',
            'manage_options',
            'clean-pdf-add-book',
            array($this, 'add_book_page')
        );
    }

    public function admin_page_content() {
        if (!current_user_can('manage_options')) {
            wp_die(__('You do not have sufficient permissions to access this page.'));
        }

        // Handle bulk actions
        if (isset($_POST['action'], $_POST['book_ids']) && $_POST['action'] === 'bulk_delete' && is_array($_POST['book_ids'])) {
            if (wp_verify_nonce($_POST['_wpnonce'], 'bulk_action_nonce')) {
                $deleted = $this->bulk_delete_books($_POST['book_ids']);
                if ($deleted > 0) {
                    echo '<div class="updated"><p>' . sprintf(__('Deleted %d book(s) successfully.'), $deleted) . '</p></div>';
                }
            }
        }

        $books = $this->get_all_books();
        ?>
        <div class="wrap">
            <h1 class="wp-heading-inline">PDF Books Manager</h1>
            <a href="<?php echo esc_url(admin_url('admin.php?page=clean-pdf-add-book')); ?>" class="page-title-action">Add New Book</a>
            <hr class="wp-header-end">
            
            <?php if (!empty($books)): ?>
            <form method="post" action="">
                <?php wp_nonce_field('bulk_action_nonce'); ?>
                
                <div class="tablenav top">
                    <div class="alignleft actions bulkactions">
                        <label for="bulk-action-selector-top" class="screen-reader-text">Select bulk action</label>
                        <select name="action" id="bulk-action-selector-top">
                            <option value="-1">Bulk Actions</option>
                            <option value="bulk_delete">Delete</option>
                        </select>
                        <input type="submit" id="doaction" class="button action" value="Apply">
                    </div>
                </div>
                
                <table class="wp-list-table widefat fixed striped table-view-list">
                    <thead>
                        <tr>
                            <td id="cb" class="manage-column column-cb check-column">
                                <label class="screen-reader-text" for="cb-select-all-1">Select All</label>
                                <input id="cb-select-all-1" type="checkbox">
                            </td>
                            <th scope="col" class="manage-column column-title column-primary">Title</th>
                            <th scope="col" class="manage-column column-description">Description</th>
                            <th scope="col" class="manage-column column-size">File Size</th>
                            <th scope="col" class="manage-column column-date">Upload Date</th>
                            <th scope="col" class="manage-column column-status">Status</th>
                            <th scope="col" class="manage-column column-actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="the-list">
                        <?php foreach ($books as $book): ?>
                            <tr id="book-<?php echo esc_attr($book->id); ?>">
                                <th scope="row" class="check-column">
                                    <input type="checkbox" name="book_ids[]" value="<?php echo esc_attr($book->id); ?>" id="book_<?php echo esc_attr($book->id); ?>">
                                </th>
                                <td class="title column-title has-row-actions column-primary" data-colname="Title">
                                    <strong><?php echo esc_html($book->title); ?></strong>
                                    <div class="row-actions">
                                        <span class="edit">
                                            <button type="button" class="button-link view-shortcode" data-book-id="<?php echo esc_attr($book->id); ?>">View Shortcode</button> |
                                        </span>
                                        <span class="trash">
                                            <button type="button" class="button-link submitdelete delete-book" data-book-id="<?php echo esc_attr($book->id); ?>">Delete</button>
                                        </span>
                                    </div>
                                </td>
                                <td class="description column-description" data-colname="Description">
                                    <?php echo esc_html(wp_trim_words($book->description, 10)); ?>
                                </td>
                                <td class="size column-size" data-colname="File Size">
                                    <?php echo esc_html($this->format_file_size($book->file_size)); ?>
                                </td>
                                <td class="date column-date" data-colname="Upload Date">
                                    <?php echo esc_html(mysql2date('M j, Y', $book->created_at)); ?>
                                </td>
                                <td class="status column-status" data-colname="Status">
                                    <span class="status-badge <?php echo $book->status === 'active' ? 'status-active' : 'status-inactive'; ?>">
                                        <?php echo esc_html(ucfirst($book->status)); ?>
                                    </span>
                                </td>
                                <td class="actions column-actions" data-colname="Actions">
                                    <button type="button" class="button button-small toggle-status" 
                                            data-book-id="<?php echo esc_attr($book->id); ?>" 
                                            data-current-status="<?php echo esc_attr($book->status); ?>">
                                        <?php echo $book->status === 'active' ? 'Disable' : 'Enable'; ?>
                                    </button>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </form>
            <?php else: ?>
                <div class="no-books">
                    <p>No PDF books found. <a href="<?php echo esc_url(admin_url('admin.php?page=clean-pdf-add-book')); ?>">Add your first book</a>.</p>
                </div>
            <?php endif; ?>
            
            <!-- Shortcode Modal -->
            <div id="shortcode-modal" style="display:none;">
                <div class="shortcode-modal-content">
                    <span class="shortcode-close">&times;</span>
                    <h3>Shortcode for Book</h3>
                    <p>Use this shortcode to display the PDF viewer:</p>
                    <input type="text" id="shortcode-text" readonly>
                    <p><strong>Book Selector:</strong> Use <code>[pdf_book_selector]</code> to show all active books</p>
                </div>
            </div>
        </div>

        <?php $this->admin_page_styles(); ?>
        <?php $this->admin_page_scripts(); ?>
        <?php
    }

    private function admin_page_styles() {
        ?>
        <style>
        .status-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
        }
        .status-active { 
            background: #46b450; 
            color: white; 
        }
        .status-inactive { 
            background: #dc3232; 
            color: white; 
        }
        
        #shortcode-modal {
            position: fixed;
            z-index: 100000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        .shortcode-modal-content {
            background-color: #fefefe;
            margin: 15% auto;
            padding: 20px;
            border: 1px solid #888;
            width: 80%;
            max-width: 500px;
            border-radius: 5px;
            position: relative;
        }
        .shortcode-close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            line-height: 1;
            position: absolute;
            right: 15px;
            top: 15px;
        }
        .shortcode-close:hover,
        .shortcode-close:focus {
            color: #000;
            text-decoration: none;
        }
        #shortcode-text {
            width: 100%;
            padding: 8px;
            margin: 10px 0;
            font-family: Monaco, Consolas, monospace;
            font-size: 12px;
        }
        .no-books {
            text-align: center;
            padding: 50px 20px;
            color: #666;
        }
        </style>
        <?php
    }

    private function admin_page_scripts() {
        ?>
        <script>
        jQuery(document).ready(function($) {
            // Toggle status
            $('.toggle-status').on('click', function(e) {
                e.preventDefault();
                var $button = $(this);
                var bookId = $button.data('book-id');
                var originalText = $button.text();
                
                $button.prop('disabled', true).text('Processing...');
                
                $.post(ajaxurl, {
                    action: 'toggle_book_status',
                    book_id: bookId,
                    nonce: '<?php echo wp_create_nonce('toggle_status_nonce'); ?>'
                })
                .done(function(response) {
                    if (response.success) {
                        location.reload();
                    } else {
                        alert('Error: ' + (response.data || 'Unknown error'));
                        $button.prop('disabled', false).text(originalText);
                    }
                })
                .fail(function() {
                    alert('Network error occurred');
                    $button.prop('disabled', false).text(originalText);
                });
            });
            
            // Delete book
            $('.delete-book').on('click', function(e) {
                e.preventDefault();
                if (!confirm('Are you sure you want to delete this book? This action cannot be undone.')) {
                    return;
                }
                
                var $button = $(this);
                var bookId = $button.data('book-id');
                
                $.post(ajaxurl, {
                    action: 'delete_book',
                    book_id: bookId,
                    nonce: '<?php echo wp_create_nonce('delete_book_nonce'); ?>'
                })
                .done(function(response) {
                    if (response.success) {
                        $('#book-' + bookId).fadeOut(300, function() {
                            $(this).remove();
                        });
                    } else {
                        alert('Error: ' + (response.data || 'Unknown error'));
                    }
                })
                .fail(function() {
                    alert('Network error occurred');
                });
            });
            
            // View shortcode
            $('.view-shortcode').on('click', function(e) {
                e.preventDefault();
                var bookId = $(this).data('book-id');
                $('#shortcode-text').val('[clean_pdf_viewer book_id="' + bookId + '"]').select();
                $('#shortcode-modal').show();
            });
            
            // Close modal
            $('.shortcode-close').on('click', function() {
                $('#shortcode-modal').hide();
            });
            
            $(document).on('click', function(e) {
                if (e.target.id === 'shortcode-modal') {
                    $('#shortcode-modal').hide();
                }
            });
            
            // Select all checkbox
            $('#cb-select-all-1').on('change', function() {
                $('input[name="book_ids[]"]').prop('checked', this.checked);
            });
        });
        </script>
        <?php
    }

    public function add_book_page() {
        if (!current_user_can('manage_options')) {
            wp_die(__('You do not have sufficient permissions to access this page.'));
        }
        
        $message = '';
        
        if (isset($_POST['submit_book']) && wp_verify_nonce($_POST['_wpnonce'], 'add_book_nonce')) {
            $result = $this->handle_book_upload();
            if ($result['success']) {
                $message = '<div class="updated"><p>' . esc_html($result['message']) . '</p></div>';
            } else {
                $message = '<div class="error"><p>' . esc_html($result['message']) . '</p></div>';
            }
        }

        ?>
        <div class="wrap">
            <h1>Add New PDF Book</h1>
            
            <?php 
            echo $message;
            $this->display_server_limits();
            ?>
            
            <form method="post" enctype="multipart/form-data" novalidate="novalidate">
                <?php wp_nonce_field('add_book_nonce'); ?>
                
                <table class="form-table" role="presentation">
                    <tbody>
                        <tr>
                            <th scope="row">
                                <label for="book_title">Book Title <span class="description">(required)</span></label>
                            </th>
                            <td>
                                <input type="text" id="book_title" name="book_title" class="regular-text" required 
                                       value="<?php echo isset($_POST['book_title']) ? esc_attr($_POST['book_title']) : ''; ?>">
                                <p class="description">Enter the title of the book</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label for="book_description">Description</label>
                            </th>
                            <td>
                                <textarea id="book_description" name="book_description" rows="3" cols="50" class="large-text"><?php echo isset($_POST['book_description']) ? esc_textarea($_POST['book_description']) : ''; ?></textarea>
                                <p class="description">Optional description of the book</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label for="pdf_file">PDF File <span class="description">(required)</span></label>
                            </th>
                            <td>
                                <input type="file" id="pdf_file" name="pdf_file" accept=".pdf" required>
                                <p class="description">Select a PDF file to upload (Maximum size: 20MB or server limit, whichever is lower)</p>
                                <div id="file-preview" style="margin-top: 10px; display: none;">
                                    <strong>Selected file:</strong>
                                    <div id="file-info"></div>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label for="book_status">Status</label>
                            </th>
                            <td>
                                <select id="book_status" name="book_status">
                                    <option value="active" <?php selected(isset($_POST['book_status']) ? $_POST['book_status'] : 'active', 'active'); ?>>Active</option>
                                    <option value="inactive" <?php selected(isset($_POST['book_status']) ? $_POST['book_status'] : '', 'inactive'); ?>>Inactive</option>
                                </select>
                                <p class="description">Active books will be visible to users</p>
                            </td>
                        </tr>
                    </tbody>
                </table>
                
                <?php submit_button('Add Book', 'primary', 'submit_book'); ?>
            </form>
            
            <script>
            document.addEventListener('DOMContentLoaded', function() {
                const fileInput = document.getElementById('pdf_file');
                const filePreview = document.getElementById('file-preview');
                const fileInfo = document.getElementById('file-info');
                
                if (fileInput) {
                    fileInput.addEventListener('change', function(e) {
                        const file = e.target.files[0];
                        if (file) {
                            const maxSize = 20 * 1024 * 1024;
                            
                            fileInfo.innerHTML = `
                                <p><strong>Name:</strong> ${file.name}</p>
                                <p><strong>Size:</strong> ${(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                                <p><strong>Type:</strong> ${file.type}</p>
                            `;
                            filePreview.style.display = 'block';
                            
                            if (file.size > maxSize) {
                                alert('File size exceeds 20MB limit. Please choose a smaller file.');
                                e.target.value = '';
                                filePreview.style.display = 'none';
                                return;
                            }
                            
                            if (file.type !== 'application/pdf') {
                                alert('Please select a PDF file.');
                                e.target.value = '';
                                filePreview.style.display = 'none';
                                return;
                            }
                        } else {
                            filePreview.style.display = 'none';
                        }
                    });
                }
            });
            </script>
        </div>
        <?php
    }

    private function handle_book_upload() {
        try {
            $limits = $this->check_upload_limits();
            
            if (!isset($_FILES['pdf_file'])) {
                return array('success' => false, 'message' => 'No file was uploaded.');
            }
            
            $file = $_FILES['pdf_file'];
            
            switch ($file['error']) {
                case UPLOAD_ERR_OK:
                    break;
                case UPLOAD_ERR_INI_SIZE:
                    return array('success' => false, 'message' => 'File exceeds server upload limit (' . size_format($limits['upload_max_filesize']) . '). Please choose a smaller file or contact your administrator.');
                case UPLOAD_ERR_FORM_SIZE:
                    return array('success' => false, 'message' => 'File exceeds form upload limit.');
                case UPLOAD_ERR_PARTIAL:
                    return array('success' => false, 'message' => 'File was only partially uploaded. Please try again.');
                case UPLOAD_ERR_NO_FILE:
                    return array('success' => false, 'message' => 'No file was selected.');
                default:
                    return array('success' => false, 'message' => 'Upload error occurred.');
            }
            
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime_type = finfo_file($finfo, $file['tmp_name']);
            finfo_close($finfo);
            
            if ($mime_type !== 'application/pdf') {
                return array('success' => false, 'message' => 'Invalid file type detected: ' . $mime_type . '. Only PDF files are allowed.');
            }
            
            $max_file_size = 20 * 1024 * 1024;
            if ($file['size'] > $max_file_size) {
                return array('success' => false, 'message' => 'File size (' . size_format($file['size']) . ') exceeds plugin limit of 20MB. Please choose a smaller file.');
            }
            
            if ($file['size'] > $limits['upload_max_filesize']) {
                return array('success' => false, 'message' => 'File size (' . size_format($file['size']) . ') exceeds server upload limit (' . size_format($limits['upload_max_filesize']) . '). Please contact your administrator to increase upload limits.');
            }

            $upload_dir = wp_upload_dir();
            if ($upload_dir['error']) {
                return array('success' => false, 'message' => 'Upload directory error: ' . $upload_dir['error']);
            }
            
            $protected_dir = $upload_dir['basedir'] . '/protected';
            
            if (!file_exists($protected_dir)) {
                if (!wp_mkdir_p($protected_dir)) {
                    return array('success' => false, 'message' => 'Failed to create upload directory. Please check permissions.');
                }
                
                $htaccess_content = "Order Deny,Allow\nDeny from all\n<Files ~ \"\\.(pdf)$\">\nOrder Allow,Deny\nDeny from all\n</Files>";
                if (!file_put_contents($protected_dir . '/.htaccess', $htaccess_content)) {
                    error_log('Failed to create .htaccess file in protected directory');
                }
            }

            $title_slug = sanitize_title($_POST['book_title']);
            $title_slug = substr($title_slug, 0, 50);
            $filename = $title_slug . '_' . uniqid() . '.pdf';
            $filepath = $protected_dir . '/' . $filename;

            if (!is_writable($protected_dir)) {
                return array('success' => false, 'message' => 'Upload directory is not writable. Please check directory permissions.');
            }

            if (!move_uploaded_file($file['tmp_name'], $filepath)) {
                $error = error_get_last();
                return array('success' => false, 'message' => 'Failed to move uploaded file: ' . ($error['message'] ?? 'Unknown error'));
            }

            if (!file_exists($filepath) || !is_readable($filepath)) {
                return array('success' => false, 'message' => 'File upload verification failed.');
            }

            global $wpdb;
            $result = $wpdb->insert(
                $this->table_name,
                array(
                    'title' => sanitize_text_field($_POST['book_title']),
                    'description' => sanitize_textarea_field($_POST['book_description']),
                    'filename' => $filename,
                    'filepath' => $filepath,
                    'file_size' => intval($file['size']),
                    'status' => sanitize_text_field($_POST['book_status']),
                    'created_at' => current_time('mysql')
                ),
                array('%s', '%s', '%s', '%s', '%d', '%s', '%s')
            );

            if ($result === false) {
                if (file_exists($filepath)) {
                    unlink($filepath);
                }
                return array('success' => false, 'message' => 'Database error: ' . $wpdb->last_error);
            }

            return array('success' => true, 'message' => 'Book "' . $_POST['book_title'] . '" uploaded successfully! File size: ' . size_format($file['size']));
            
        } catch (Exception $e) {
            error_log('PDF Upload Error: ' . $e->getMessage());
            return array('success' => false, 'message' => 'An unexpected error occurred: ' . $e->getMessage());
        }
    }

    private function check_upload_limits() {
        $max_upload = $this->parse_size(ini_get('upload_max_filesize'));
        $max_post = $this->parse_size(ini_get('post_max_size'));
        $memory_limit = $this->parse_size(ini_get('memory_limit'));
        
        return array(
            'upload_max_filesize' => $max_upload,
            'post_max_size' => $max_post,
            'memory_limit' => $memory_limit,
            'recommended_min' => 25 * 1024 * 1024
        );
    }

    private function parse_size($size) {
        $unit = preg_replace('/[^bkmgtpezy]/i', '', $size);
        $size = preg_replace('/[^0-9\.]/', '', $size);
        
        if ($unit) {
            return round($size * pow(1024, stripos('bkmgtpezy', $unit[0])));
        } else {
            return round($size);
        }
    }

    public function display_server_limits() {
        $limits = $this->check_upload_limits();
        ?>
        <div class="notice notice-info">
            <p><strong>Server Upload Limits:</strong></p>
            <ul style="margin-left: 20px;">
                <li>Max Upload Size: <strong><?php echo size_format($limits['upload_max_filesize']); ?></strong></li>
                <li>Max Post Size: <strong><?php echo size_format($limits['post_max_size']); ?></strong></li>
                <li>Memory Limit: <strong><?php echo size_format($limits['memory_limit']); ?></strong></li>
            </ul>
            <?php if ($limits['upload_max_filesize'] < $limits['recommended_min']): ?>
            <p><em><strong>Recommendation:</strong> Consider increasing your server's upload_max_filesize setting to at least 25MB for larger PDFs. Contact your hosting provider or system administrator.</em></p>
            <?php endif; ?>
        </div>
        <?php
    }

    public function toggle_book_status() {
        if (!wp_verify_nonce($_POST['nonce'], 'toggle_status_nonce') || !current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }

        $book_id = intval($_POST['book_id']);
        if (!$book_id) {
            wp_send_json_error('Invalid book ID');
        }

        global $wpdb;
        
        $current_status = $wpdb->get_var($wpdb->prepare(
            "SELECT status FROM {$this->table_name} WHERE id = %d", 
            $book_id
        ));

        if ($current_status === null) {
            wp_send_json_error('Book not found');
        }

        $new_status = ($current_status === 'active') ? 'inactive' : 'active';
        
        $result = $wpdb->update(
            $this->table_name,
            array('status' => $new_status),
            array('id' => $book_id),
            array('%s'),
            array('%d')
        );

        if ($result !== false) {
            wp_send_json_success('Status updated successfully');
        } else {
            wp_send_json_error('Failed to update status');
        }
    }

    public function delete_book() {
        if (!wp_verify_nonce($_POST['nonce'], 'delete_book_nonce') || !current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }

        $book_id = intval($_POST['book_id']);
        if (!$book_id) {
            wp_send_json_error('Invalid book ID');
        }

        global $wpdb;
        
        $book = $wpdb->get_row($wpdb->prepare(
            "SELECT filepath FROM {$this->table_name} WHERE id = %d", 
            $book_id
        ));

        if (!$book) {
            wp_send_json_error('Book not found');
        }

        if (file_exists($book->filepath)) {
            unlink($book->filepath);
        }

        $result = $wpdb->delete(
            $this->table_name,
            array('id' => $book_id),
            array('%d')
        );

        if ($result !== false) {
            wp_send_json_success('Book deleted successfully');
        } else {
            wp_send_json_error('Failed to delete book');
        }
    }

    private function bulk_delete_books($book_ids) {
        $deleted_count = 0;
        global $wpdb;
        
        foreach ($book_ids as $book_id) {
            $book_id = intval($book_id);
            if (!$book_id) continue;
            
            $book = $wpdb->get_row($wpdb->prepare(
                "SELECT filepath FROM {$this->table_name} WHERE id = %d", 
                $book_id
            ));

            if ($book) {
                if (file_exists($book->filepath)) {
                    unlink($book->filepath);
                }

                $result = $wpdb->delete(
                    $this->table_name,
                    array('id' => $book_id),
                    array('%d')
                );
                
                if ($result !== false) {
                    $deleted_count++;
                }
            }
        }
        
        return $deleted_count;
    }

    public function pdf_viewer_shortcode($atts) {
        $atts = shortcode_atts(array(
            'url' => '',
            'pdf' => '',
            'book_id' => '',
            'width' => '100%',
            'height' => '600px'
        ), $atts);

        if (!empty($atts['book_id'])) {
            $book = $this->get_book_by_id(intval($atts['book_id']));
            if (!$book || $book->status !== 'active') {
                return '<p>Book not found or not available.</p>';
            }
            
            $atts['url'] = add_query_arg(array(
                'action' => 'serve_protected_pdf',
                'book_id' => $book->id,
                'nonce' => wp_create_nonce('serve_pdf_' . $book->id)
            ), admin_url('admin-ajax.php'));
        } else {
            $atts['url'] = !empty($atts['url']) ? $atts['url'] : $atts['pdf'];
        }

        if (empty($atts['url'])) {
            return '<p>Please provide a PDF URL or book ID.</p>';
        }
        
        $viewer_id = 'pdf-viewer-' . uniqid();
        
        ob_start();
        ?>
        <div class="clean-pdf-viewer-container" style="width: <?php echo esc_attr($atts['width']); ?>; height: <?php echo esc_attr($atts['height']); ?>;">
            <div class="pdf-controls">
                <div class="pdf-controls-left">
                    <button class="pdf-btn pdf-prev" data-viewer="<?php echo esc_attr($viewer_id); ?>">← Previous</button>
                    <span class="pdf-page-info">Page <span class="pdf-current-page">1</span> of <span class="pdf-total-pages">-</span></span>
                    <button class="pdf-btn pdf-next" data-viewer="<?php echo esc_attr($viewer_id); ?>">Next →</button>
                </div>
                <div class="pdf-controls-right">
                    <button class="pdf-btn pdf-zoom-out" data-viewer="<?php echo esc_attr($viewer_id); ?>">Zoom Out</button>
                    <span class="pdf-zoom-level">100%</span>
                    <button class="pdf-btn pdf-zoom-in" data-viewer="<?php echo esc_attr($viewer_id); ?>">Zoom In</button>
                    <button class="pdf-btn pdf-fullscreen" data-viewer="<?php echo esc_attr($viewer_id); ?>">Fullscreen</button>
                </div>
            </div>
            <div class="pdf-viewer-wrapper">
                <canvas id="<?php echo esc_attr($viewer_id); ?>" class="pdf-canvas" data-pdf-url="<?php echo esc_attr($atts['url']); ?>"></canvas>
            </div>
            <div class="pdf-loading">Loading PDF...</div>
            <div class="pdf-error" style="display: none;">Error loading PDF. Please try again.</div>
            <div aria-live="polite" class="sr-only"></div>
        </div>
        <?php
        return ob_get_clean();
    }

    public function book_selector_shortcode($atts) {
        $atts = shortcode_atts(array(
            'show_description' => 'true',
            'auto_load_first' => 'true',
            'columns' => 'auto'
        ), $atts);

        $books = $this->get_active_books();
        
        if (empty($books)) {
            return '<div class="no-books-message"><h3>No Books Available</h3><p>No PDF books are currently available. Please check back later.</p></div>';
        }

        ob_start();
        ?>
        <div class="pdf-book-selector">
            <h3>Select a Book to Read</h3>
            <div class="book-grid" style="<?php echo $atts['columns'] !== 'auto' ? 'grid-template-columns: repeat(' . intval($atts['columns']) . ', 1fr);' : ''; ?>">
                <?php foreach ($books as $index => $book): ?>
                    <div class="book-item <?php echo $index === 0 ? 'first-book' : ''; ?>">
                        <div class="book-cover">
                            <span class="book-icon">📖</span>
                        </div>
                        <h4><?php echo esc_html($book->title); ?></h4>
                        <?php if ($atts['show_description'] === 'true' && !empty($book->description)): ?>
                            <p class="book-description"><?php echo esc_html(wp_trim_words($book->description, 15)); ?></p>
                        <?php endif; ?>
                        <div class="book-meta">
                            <small class="book-size"><?php echo esc_html($this->format_file_size($book->file_size)); ?></small>
                        </div>
                        <button class="read-book-btn <?php echo $index === 0 && $atts['auto_load_first'] === 'true' ? 'active' : ''; ?>" 
                                data-book-id="<?php echo esc_attr($book->id); ?>"
                                <?php echo $index === 0 ? 'data-auto-load="true"' : ''; ?>>
                            <?php echo $index === 0 && $atts['auto_load_first'] === 'true' ? 'Currently Reading' : 'Read Book'; ?>
                        </button>
                    </div>
                <?php endforeach; ?>
            </div>
            
            <div id="pdf-viewer-container" role="main" aria-label="PDF Viewer">
                <?php if ($atts['auto_load_first'] === 'true'): ?>
                    <div class="pdf-viewer-loading">
                        <div class="book-loading"></div>
                        <p>Loading first book...</p>
                    </div>
                <?php endif; ?>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    public function serve_protected_pdf() {
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            wp_die('Method not allowed', 'Method Not Allowed', array('response' => 405));
        }

        $book_id = isset($_GET['book_id']) ? intval($_GET['book_id']) : 0;
        $nonce = isset($_GET['nonce']) ? sanitize_text_field($_GET['nonce']) : '';

        if (!$book_id || empty($nonce)) {
            wp_die('Invalid request', 'Bad Request', array('response' => 400));
        }

        // Verify nonce
        if (!wp_verify_nonce($nonce, 'serve_pdf_' . $book_id)) {
            wp_die('Security check failed', 'Unauthorized', array('response' => 401));
        }

        $book = $this->get_book_by_id($book_id);
        if (!$book || $book->status !== 'active') {
            wp_die('Book not found or not available', 'Not Found', array('response' => 404));
        }

        if (!file_exists($book->filepath)) {
            wp_die('File not found on server', 'Not Found', array('response' => 404));
        }

        // Security headers
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: SAMEORIGIN');
        header('X-XSS-Protection: 1; mode=block');
        header('Referrer-Policy: same-origin');
        
        // PDF serving headers
        header('Content-Type: application/pdf');
        header('Content-Length: ' . filesize($book->filepath));
        header('Content-Disposition: inline; filename="' . basename($book->filename) . '"');
        header('Cache-Control: private, max-age=3600, must-revalidate');
        header('Pragma: public');
        header('Accept-Ranges: bytes');

        // Handle range requests for better streaming
        if (isset($_SERVER['HTTP_RANGE'])) {
            $this->serve_file_with_range($book->filepath);
        } else {
            readfile($book->filepath);
        }
        exit;
    }

    private function serve_file_with_range($filepath) {
        $filesize = filesize($filepath);
        $range = $_SERVER['HTTP_RANGE'];
        
        if (preg_match('/bytes=(\d+)-(\d+)?/', $range, $matches)) {
            $start = intval($matches[1]);
            $end = isset($matches[2]) && $matches[2] !== '' ? intval($matches[2]) : $filesize - 1;
            
            if ($start > $end || $start >= $filesize) {
                header('HTTP/1.1 416 Requested Range Not Satisfiable');
                header("Content-Range: bytes */$filesize");
                exit;
            }
            
            $length = $end - $start + 1;
            
            header('HTTP/1.1 206 Partial Content');
            header("Content-Range: bytes $start-$end/$filesize");
            header("Content-Length: $length");
            
            $file = fopen($filepath, 'rb');
            fseek($file, $start);
            echo fread($file, $length);
            fclose($file);
        }
    }

    public function load_pdf_viewer() {
        if (!wp_verify_nonce($_POST['nonce'], 'load_pdf_nonce')) {
            wp_send_json_error(array('message' => 'Security check failed.'));
        }

        $book_id = isset($_POST['book_id']) ? intval($_POST['book_id']) : 0;
        if (!$book_id) {
            wp_send_json_error(array('message' => 'Invalid book ID.'));
        }

        $book = $this->get_book_by_id($book_id);
        if (!$book || $book->status !== 'active') {
            wp_send_json_error(array('message' => 'Book not found or inactive.'));
        }

        $pdf_url = add_query_arg(array(
            'action' => 'serve_protected_pdf',
            'book_id' => $book->id,
            'nonce' => wp_create_nonce('serve_pdf_' . $book->id)
        ), admin_url('admin-ajax.php'));

        $viewer_id = 'pdf-viewer-book-' . $book->id . '-' . time();
        
        ob_start();
        ?>
        <div class="clean-pdf-viewer-container" style="width: 100%; height: 600px;">
            <div class="pdf-controls">
                <div class="pdf-controls-left">
                    <button class="pdf-btn pdf-prev" data-viewer="<?php echo esc_attr($viewer_id); ?>">← Previous</button>
                    <span class="pdf-page-info">Page <span class="pdf-current-page">1</span> of <span class="pdf-total-pages">-</span></span>
                    <button class="pdf-btn pdf-next" data-viewer="<?php echo esc_attr($viewer_id); ?>">Next →</button>
                </div>
                <div class="pdf-controls-right">
                    <button class="pdf-btn pdf-zoom-out" data-viewer="<?php echo esc_attr($viewer_id); ?>">Zoom Out</button>
                    <span class="pdf-zoom-level">100%</span>
                    <button class="pdf-btn pdf-zoom-in" data-viewer="<?php echo esc_attr($viewer_id); ?>">Zoom In</button>
                    <button class="pdf-btn pdf-fullscreen" data-viewer="<?php echo esc_attr($viewer_id); ?>">Fullscreen</button>
                </div>
            </div>
            <div class="pdf-viewer-wrapper">
                <canvas id="<?php echo esc_attr($viewer_id); ?>" class="pdf-canvas" data-pdf-url="<?php echo esc_attr($pdf_url); ?>"></canvas>
            </div>
            <div class="pdf-loading">Loading PDF...</div>
            <div class="pdf-error" style="display: none;">Error loading PDF. Please try again.</div>
            <div aria-live="polite" class="sr-only"></div>
        </div>
        <?php
        $viewer_html = ob_get_clean();

        wp_send_json_success(array('html' => $viewer_html));
    }

    // Database helper methods
    private function get_all_books() {
        global $wpdb;
        return $wpdb->get_results("SELECT * FROM {$this->table_name} ORDER BY created_at DESC");
    }

    private function get_active_books() {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$this->table_name} WHERE status = %s ORDER BY created_at DESC",
            'active'
        ));
    }

    private function get_book_by_id($book_id) {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table_name} WHERE id = %d",
            $book_id
        ));
    }

    private function format_file_size($bytes) {
        $bytes = intval($bytes);
        if ($bytes >= 1073741824) {
            return number_format($bytes / 1073741824, 2) . ' GB';
        } elseif ($bytes >= 1048576) {
            return number_format($bytes / 1048576, 2) . ' MB';
        } elseif ($bytes >= 1024) {
            return number_format($bytes / 1024, 2) . ' KB';
        } else {
            return $bytes . ' bytes';
        }
    }

    // WordPress integration methods
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
        if (!current_user_can('activate_plugins')) {
            return;
        }
        
        $this->create_database_table();
        
        $upload_dir = wp_upload_dir();
        if ($upload_dir['error'] === false) {
            $protected_dir = $upload_dir['basedir'] . '/protected';
            
            if (!file_exists($protected_dir)) {
                wp_mkdir_p($protected_dir);
                $htaccess_content = "Order Deny,Allow\nDeny from all\n<Files ~ \"\\.(pdf)$\">\nOrder Allow,Deny\nDeny from all\n</Files>";
                file_put_contents($protected_dir . '/.htaccess', $htaccess_content);
            }
        }
        
        flush_rewrite_rules();
    }
    
    public function deactivate() {
        flush_rewrite_rules();
    }

    private function create_database_table() {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE {$this->table_name} (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            title varchar(255) NOT NULL,
            description text,
            filename varchar(255) NOT NULL,
            filepath varchar(500) NOT NULL,
            file_size bigint(20) NOT NULL DEFAULT 0,
            status varchar(20) NOT NULL DEFAULT 'active',
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY status (status),
            KEY created_at (created_at)
        ) $charset_collate;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    
    public function init() {
        // Plugin initialization
    }
    
    public function enqueue_scripts() {
        global $post;
        
        $load_scripts = false;
        
        if (is_a($post, 'WP_Post')) {
            if (has_shortcode($post->post_content, 'clean_pdf_viewer') || 
                has_shortcode($post->post_content, 'pdf_book_selector')) {
                $load_scripts = true;
            }
        }
        
        if (!$load_scripts && is_active_widget(false, false, 'text')) {
            $load_scripts = true;
        }
        
        if (!$load_scripts) {
            return;
        }
        
        wp_enqueue_script(
            'pdfjs-dist',
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
            array(),
            '3.11.174',
            true
        );
        
        wp_add_inline_style('wp-block-library', $this->get_inline_css());
        wp_add_inline_script('pdfjs-dist', $this->get_inline_js());
        
        wp_localize_script('pdfjs-dist', 'cleanPdfAjax', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('clean_pdf_nonce'),
            'load_pdf_nonce' => wp_create_nonce('load_pdf_nonce'),
            'plugin_url' => plugin_dir_url(__FILE__),
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

    private function get_inline_css() {
        return '
        .clean-pdf-viewer-container{border:1px solid #ddd;border-radius:12px;overflow:hidden;background:#f9f9f9;position:relative;box-shadow:0 5px 15px rgba(0,0,0,0.08)}
        .pdf-controls{background:linear-gradient(135deg,#2c3e50,#34495e);padding:15px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
        .pdf-controls-left,.pdf-controls-right{display:flex;align-items:center;gap:15px;flex-wrap:wrap}
        .pdf-btn{background:#3498db;color:white;border:none;padding:12px 20px;font-size:16px;font-weight:bold;border-radius:6px;cursor:pointer;transition:all 0.3s ease;min-width:120px}
        .pdf-btn:hover{background:#2980b9;transform:translateY(-2px)}
        .pdf-btn:disabled{background:#7f8c8d;cursor:not-allowed;transform:none}
        .pdf-fullscreen{background:#9b59b6!important}
        .pdf-page-info,.pdf-zoom-level{color:white;font-weight:bold;font-size:14px;background:rgba(255,255,255,0.1);padding:8px 12px;border-radius:4px}
        .pdf-viewer-wrapper{background:white;overflow:auto;height:calc(100% - 70px);display:flex;justify-content:center;align-items:flex-start;padding:20px}
        .pdf-canvas{max-width:100%;box-shadow:0 4px 8px rgba(0,0,0,0.1);border-radius:4px}
        .pdf-loading,.pdf-error{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:20px 30px;border-radius:8px;color:white;font-weight:bold}
        .pdf-loading{background:rgba(0,0,0,0.8)}
        .pdf-error{background:#e74c3c}
        .pdf-book-selector{max-width:1200px;margin:0 auto;padding:20px}
        .book-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:25px;margin:20px 0}
        .book-item{border:1px solid #e1e8ed;border-radius:12px;padding:25px;text-align:center;transition:all 0.3s ease;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
        .book-item:hover{transform:translateY(-8px);box-shadow:0 8px 25px rgba(0,0,0,0.15)}
        .read-book-btn{background:linear-gradient(135deg,#3498db,#2980b9);color:white;border:none;padding:12px 24px;border-radius:25px;cursor:pointer;font-weight:600;transition:all 0.3s ease}
        .read-book-btn.active{background:linear-gradient(135deg,#27ae60,#219a52);box-shadow:0 4px 15px rgba(39,174,96,0.4)}
        #pdf-viewer-container{margin-top:40px;opacity:0;transition:all 0.5s ease}
        #pdf-viewer-container.loaded{opacity:1}
        @media (max-width:768px){.pdf-controls{flex-direction:column}.book-grid{grid-template-columns:1fr}}
        ';
    }

    private function get_inline_js() {
        return '
        document.addEventListener("DOMContentLoaded", function() {
            if (typeof pdfjsLib !== "undefined") {
                pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
                
                // Initialize PDF viewers
                document.querySelectorAll(".pdf-canvas").forEach(function(canvas) {
                    new CleanPDFViewer(canvas);
                });
                
                // Initialize book selector
                if (document.querySelector(".pdf-book-selector")) {
                    new PDFBookSelector();
                }
            }
            
            class CleanPDFViewer {
                constructor(canvas) {
                    this.canvas = canvas;
                    this.ctx = canvas.getContext("2d");
                    this.pdfDoc = null;
                    this.pageNum = 1;
                    this.pageRendering = false;
                    this.pageNumPending = null;
                    this.scale = 1.2;
                    this.pdfUrl = canvas.dataset.pdfUrl;
                    this.viewerId = canvas.id;
                    this.container = canvas.closest(".clean-pdf-viewer-container");
                    this.isFullscreen = false;
                    
                    this.init();
                }
                
                async init() {
                    try {
                        this.showLoading();
                        
                        const loadingTask = pdfjsLib.getDocument({
                            url: this.pdfUrl,
                            withCredentials: false
                        });
                        
                        this.pdfDoc = await loadingTask.promise;
                        this.hideLoading();
                        this.updatePageInfo();
                        await this.renderPage(this.pageNum);
                        this.bindEvents();
                        
                    } catch (error) {
                        console.error("Error loading PDF:", error);
                        this.showError();
                    }
                }
                
                bindEvents() {
                    const prevBtn = this.container.querySelector("[data-viewer=\"" + this.viewerId + "\"].pdf-prev");
                    const nextBtn = this.container.querySelector("[data-viewer=\"" + this.viewerId + "\"].pdf-next");
                    const zoomInBtn = this.container.querySelector("[data-viewer=\"" + this.viewerId + "\"].pdf-zoom-in");
                    const zoomOutBtn = this.container.querySelector("[data-viewer=\"" + this.viewerId + "\"].pdf-zoom-out");
                    const fullscreenBtn = this.container.querySelector("[data-viewer=\"" + this.viewerId + "\"].pdf-fullscreen");
                    
                    if (prevBtn) prevBtn.addEventListener("click", () => this.prevPage());
                    if (nextBtn) nextBtn.addEventListener("click", () => this.nextPage());
                    if (zoomInBtn) zoomInBtn.addEventListener("click", () => this.zoomIn());
                    if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => this.zoomOut());
                    if (fullscreenBtn) fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
                }
                
                async renderPage(num) {
                    if (this.pageRendering) {
                        this.pageNumPending = num;
                        return;
                    }
                    
                    this.pageRendering = true;
                    
                    try {
                        const page = await this.pdfDoc.getPage(num);
                        const viewport = page.getViewport({ scale: this.scale });
                        
                        this.canvas.width = viewport.width;
                        this.canvas.height = viewport.height;
                        
                        const renderContext = {
                            canvasContext: this.ctx,
                            viewport: viewport
                        };
                        
                        await page.render(renderContext).promise;
                        
                        this.pageRendering = false;
                        
                        if (this.pageNumPending !== null) {
                            const pending = this.pageNumPending;
                            this.pageNumPending = null;
                            this.renderPage(pending);
                        }
                        
                        this.updateControls();
                        
                    } catch (error) {
                        console.error("Error rendering page:", error);
                        this.pageRendering = false;
                        this.showError();
                    }
                }
                
                prevPage() {
                    if (this.pageNum <= 1) return;
                    this.pageNum--;
                    this.renderPage(this.pageNum);
                }
                
                nextPage() {
                    if (this.pageNum >= this.pdfDoc.numPages) return;
                    this.pageNum++;
                    this.renderPage(this.pageNum);
                }
                
                zoomIn() {
                    if (this.scale >= 3.0) return;
                    this.scale += 0.25;
                    this.renderPage(this.pageNum);
                }
                
                zoomOut() {
                    if (this.scale <= 0.5) return;
                    this.scale -= 0.25;
                    this.renderPage(this.pageNum);
                }
                
                toggleFullscreen() {
                    if (!this.isFullscreen) {
                        this.container.classList.add("fullscreen");
                        this.isFullscreen = true;
                    } else {
                        this.container.classList.remove("fullscreen");
                        this.isFullscreen = false;
                    }
                    setTimeout(() => this.renderPage(this.pageNum), 100);
                }
                
                updateControls() {
                    const prevBtn = this.container.querySelector(".pdf-prev");
                    const nextBtn = this.container.querySelector(".pdf-next");
                    const currentPageSpan = this.container.querySelector(".pdf-current-page");
                    const zoomLevel = this.container.querySelector(".pdf-zoom-level");
                    
                    if (prevBtn) prevBtn.disabled = (this.pageNum <= 1);
                    if (nextBtn) nextBtn.disabled = (this.pageNum >= this.pdfDoc.numPages);
                    if (currentPageSpan) currentPageSpan.textContent = this.pageNum;
                    if (zoomLevel) zoomLevel.textContent = Math.round(this.scale * 100) + "%";
                }
                
                updatePageInfo() {
                    const totalPagesSpan = this.container.querySelector(".pdf-total-pages");
                    if (totalPagesSpan) totalPagesSpan.textContent = this.pdfDoc.numPages;
                }
                
                showLoading() {
                    const loading = this.container.querySelector(".pdf-loading");
                    const error = this.container.querySelector(".pdf-error");
                    if (loading) loading.style.display = "block";
                    if (error) error.style.display = "none";
                }
                
                hideLoading() {
                    const loading = this.container.querySelector(".pdf-loading");
                    if (loading) loading.style.display = "none";
                }
                
                showError() {
                    const loading = this.container.querySelector(".pdf-loading");
                    const error = this.container.querySelector(".pdf-error");
                    if (loading) loading.style.display = "none";
                    if (error) error.style.display = "block";
                }
            }
            
            class PDFBookSelector {
                constructor() {
                    this.initializeBookSelector();
                }
                
                initializeBookSelector() {
                    const readButtons = document.querySelectorAll(".read-book-btn");
                    const viewerContainer = document.getElementById("pdf-viewer-container");
                    
                    if (!viewerContainer) return;
                    
                    // Auto-load first book
                    const firstButton = readButtons[0];
                    if (firstButton && firstButton.dataset.autoLoad) {
                        this.loadBookViewer(firstButton, viewerContainer, true);
                    }
                    
                    // Bind click events
                    readButtons.forEach(button => {
                        button.addEventListener("click", (e) => {
                            this.loadBookViewer(e.target, viewerContainer);
                        });
                    });
                }
                
                loadBookViewer(button, container, isAutoLoad = false) {
                    const bookId = button.dataset.bookId;
                    
                    // Update button states
                    document.querySelectorAll(".read-book-btn").forEach(btn => {
                        btn.classList.remove("active");
                    });
                    button.classList.add("active");
                    
                    // Create secure PDF URL
                    const pdfUrl = cleanPdfAjax.ajax_url + "?action=serve_protected_pdf&book_id=" + bookId + "&nonce=" + this.createNonce("serve_pdf_" + bookId);
                    
                    // Generate viewer HTML
                    const viewerId = "pdf-viewer-" + bookId + "-" + Date.now();
                    const viewerHTML = this.createPDFViewerHTML(viewerId, pdfUrl);
                    
                    container.innerHTML = viewerHTML;
                    container.classList.add("loaded");
                    
                    // Initialize PDF viewer
                    const canvas = container.querySelector(".pdf-canvas");
                    if (canvas) {
                        new CleanPDFViewer(canvas);
                    }
                }
                
                createNonce(action) {
                    return btoa(action + Date.now()).replace(/[^a-zA-Z0-9]/g, "").substr(0, 10);
                }
                
                createPDFViewerHTML(viewerId, pdfUrl) {
                    return `
                        <div class="clean-pdf-viewer-container" style="width: 100%; height: 600px;">
                            <div class="pdf-controls">
                                <div class="pdf-controls-left">
                                    <button class="pdf-btn pdf-prev" data-viewer="${viewerId}">← Previous</button>
                                    <span class="pdf-page-info">Page <span class="pdf-current-page">1</span> of <span class="pdf-total-pages">-</span></span>
                                    <button class="pdf-btn pdf-next" data-viewer="${viewerId}">Next →</button>
                                </div>
                                <div class="pdf-controls-right">
                                    <button class="pdf-btn pdf-zoom-out" data-viewer="${viewerId}">Zoom Out</button>
                                    <span class="pdf-zoom-level">100%</span>
                                    <button class="pdf-btn pdf-zoom-in" data-viewer="${viewerId}">Zoom In</button>
                                    <button class="pdf-btn pdf-fullscreen" data-viewer="${viewerId}">Fullscreen</button>
                                </div>
                            </div>
                            <div class="pdf-viewer-wrapper">
                                <canvas id="${viewerId}" class="pdf-canvas" data-pdf-url="${pdfUrl}"></canvas>
                            </div>
                            <div class="pdf-loading">Loading PDF...</div>
                            <div class="pdf-error" style="display: none;">Error loading PDF. Please try again.</div>
                            <div aria-live="polite" class="sr-only"></div>
                        </div>
                    `;
                }
            }
        });
        ';
    }

    public function admin_enqueue_scripts($hook) {
        if (strpos($hook, 'clean-pdf-viewer') === false) {
            return;
        }
        
        wp_enqueue_media();
        wp_enqueue_script('jquery');
    }
}

// Initialize the plugin
new CleanPDFViewer();